import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import { DefaultArtifactClient } from '@actions/artifact';
import * as glob from '@actions/glob';

// The staged tree/out-dir checkpoint artifact grows to multi-GB (observed 14GB+ by
// mid-build) as more of the chrome/chromedriver/mini_installer ninja graph compiles.
// A transfer that size occasionally exhausts the @actions/artifact package's OWN
// internal download retries ("Artifact download failed after 5 retries"), which
// otherwise hard-fails the stage job and discards every prior stage's ninja progress,
// forcing the whole tag build back to stage 1. Retry the whole get+download at this
// outer level too (mirroring the upload retry loop below) so one flaky transfer
// doesn't cost 30-45+ build-hours of already-completed compilation.
const DOWNLOAD_RETRY_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 60000;

async function downloadArtifactWithRetry(artifact, artifactName, destPath) {
    let lastErr;
    for (let i = 0; i < DOWNLOAD_RETRY_ATTEMPTS; ++i) {
        try {
            const artifactInfo = await artifact.getArtifact(artifactName);
            await artifact.downloadArtifact(artifactInfo.artifact.id, {path: destPath});
            return;
        } catch (e) {
            lastErr = e;
            console.error(`Download artifact failed (attempt ${i + 1}/${DOWNLOAD_RETRY_ATTEMPTS}): ${e}`);
            if (i < DOWNLOAD_RETRY_ATTEMPTS - 1) {
                await new Promise(r => setTimeout(r, DOWNLOAD_RETRY_DELAY_MS));
            }
        }
    }
    throw lastErr;
}

async function run() {
    process.on('SIGINT', function() {
    })
    const finished = core.getBooleanInput('finished', {required: true});
    const from_artifact = core.getBooleanInput('from_artifact', {required: true});
    const x86 = core.getBooleanInput('x86', {required: false})
    const arm = core.getBooleanInput('arm', {required: false})
    console.log(`finished: ${finished}, artifact: ${from_artifact}`);
    if (finished) {
        core.setOutput('finished', true);
        return;
    }

    const artifact = new DefaultArtifactClient();
    const artifactName = x86 ? 'build-artifact-x86' : (arm ? 'build-artifact-arm' : 'build-artifact');

    if (from_artifact) {
        await downloadArtifactWithRetry(artifact, artifactName, 'C:\\ungoogled-chromium-windows\\build');
        await exec.exec('7z', ['x', 'C:\\ungoogled-chromium-windows\\build\\artifacts.zip',
            '-oC:\\ungoogled-chromium-windows\\build', '-y']);
        await io.rmRF('C:\\ungoogled-chromium-windows\\build\\artifacts.zip');
    }

    const args = ['build.py', '--ci', '-j', '2']
    if (x86)
        args.push('--x86')
    if (arm)
        args.push('--arm')
    await exec.exec('python', ['-m', 'pip', 'install', 'httplib2==0.22.0'], {
        cwd: 'C:\\ungoogled-chromium-windows',
        ignoreReturnCode: true
    });
    const retCode = await exec.exec('python', args, {
        cwd: 'C:\\ungoogled-chromium-windows',
        ignoreReturnCode: true
    });
    if (retCode === 0) {
        core.setOutput('finished', true);
        const globber = await glob.create('C:\\ungoogled-chromium-windows\\build\\dig-browser*',
            {matchDirectories: false});
        let packageList = await globber.glob();
        const finalArtifactName = x86 ? 'chromium-x86' : (arm ? 'chromium-arm' : 'chromium');
        for (let i = 0; i < 5; ++i) {
            try {
                await artifact.deleteArtifact(finalArtifactName);
            } catch (e) {
                // ignored
            }
            try {
                await artifact.uploadArtifact(finalArtifactName, packageList,
                    'C:\\ungoogled-chromium-windows\\build', {retentionDays: 4, compressionLevel: 0});
                break;
            } catch (e) {
                console.error(`Upload artifact failed: ${e}`);
                // Wait 10 seconds between the attempts
                await new Promise(r => setTimeout(r, 10000));
            }
        }
    } else {
        await new Promise(r => setTimeout(r, 5000));
        await exec.exec('7z', ['a', '-tzip', 'C:\\ungoogled-chromium-windows\\artifacts.zip',
            'C:\\ungoogled-chromium-windows\\build\\src', '-mx=3', '-mtc=on'], {ignoreReturnCode: true});
        for (let i = 0; i < 5; ++i) {
            try {
                await artifact.deleteArtifact(artifactName);
            } catch (e) {
                // ignored
            }
            try {
                await artifact.uploadArtifact(artifactName, ['C:\\ungoogled-chromium-windows\\artifacts.zip'],
                    'C:\\ungoogled-chromium-windows', {retentionDays: 4, compressionLevel: 0});
                break;
            } catch (e) {
                console.error(`Upload artifact failed: ${e}`);
                // Wait 10 seconds between the attempts
                await new Promise(r => setTimeout(r, 10000));
            }
        }
        core.setOutput('finished', false);
    }
}

run().catch(err => core.setFailed(err.message));
