const path = require('path');
const core = require('@actions/core');
const aws = require('aws-sdk');
const fs = require('fs');

async function run() {
    try {
        const batch = new aws.Batch({
            customUserAgent: 'amazon-batch-register-job-definition-for-github-actions'
        });

        // Get inputs
        const jobDefinitionFile = core.getInput('job-definition', { required: true });
        const deregisterOldDefinition = core.getBooleanInput('deregister-old-definition', { required: false });

        // Register the job definition
        core.debug('Registering job definition');
        const jobDefPath = path.isAbsolute(jobDefinitionFile) ?
            jobDefinitionFile :
            path.join(process.env.GITHUB_WORKSPACE, jobDefinitionFile);
        if (!fs.existsSync(jobDefPath)) {
            throw new Error(`Job definition file does not exist: ${jobDefinitionFile}`);
        }
        const jobDefContents = require(jobDefPath);

        let registerResponse;
        try {
            registerResponse = await batch.registerJobDefinition(jobDefContents).promise();
        } catch (error) {
            core.setFailed("Failed to register job definition with Batch: " + error.message);
            core.debug("Job definition contents:");
            core.debug(JSON.stringify(jobDefContents, undefined, 4));
            throw (error);
        }
        const jobDefArn = registerResponse.jobDefinitionArn;
        core.setOutput('job-definition-arn', jobDefArn);
        const jobDefName = registerResponse.jobDefinitionName;
        core.setOutput('job-definition-name', jobDefName);
        const revision = registerResponse.revision;
        core.setOutput('revision', revision);

        core.info(`Registered job definition ${jobDefName}:${revision}`);

        if (deregisterOldDefinition) {
            const oldRevision = parseInt(revision) - 1;
            if (oldRevision > 0) {
                core.info(`Deregistering old definition ${jobDefName}:${oldRevision}`);
                await batch.deregisterJobDefinition({
                    jobDefinition: `${jobDefName}:${oldRevision}`
                }).promise();
            } else {
                core.info(`No old definition to deregister for ${jobDefName}:${revision}`);
            }
        }


    }
    catch (error) {
        core.setFailed(error.message);
        core.debug(error.stack);
    }
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
    run();
}