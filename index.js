const path = require('path');
const core = require('@actions/core');
const {
    BatchClient,
    RegisterJobDefinitionCommand,
    DescribeJobDefinitionsCommand,
    DeregisterJobDefinitionCommand
} = require('@aws-sdk/client-batch');
const fs = require('fs');

async function run() {
    try {
        const batch = new BatchClient({
            customUserAgent: 'amazon-batch-register-job-definition-for-github-actions'
        });

        // Get inputs
        const jobDefinitionFile = core.getInput('job-definition', { required: true });
        const deregisterOldDefinition = core.getBooleanInput('deregister-old-definition', { required: false });
        const excludeTagsInput = core.getInput('deregister-old-definition-exclude-tags', { required: false });

        // Parse exclude tags (comma-separated list of key:value pairs)
        const excludeTags = [];
        if (excludeTagsInput) {
            const pairs = excludeTagsInput.split(',').map(pair => pair.trim()).filter(pair => pair.length > 0);
            for (const pair of pairs) {
                const colonIndex = pair.indexOf(':');
                if (colonIndex > 0) {
                    const key = pair.substring(0, colonIndex).trim();
                    const value = pair.substring(colonIndex + 1).trim();
                    if (key && value) {
                        excludeTags.push({ key, value });
                    }
                }
            }
        }

        if (excludeTags.length > 0) {
            core.info(`Tag key:value pairs that will exclude definitions from deregistration: ${excludeTags.map(t => `${t.key}:${t.value}`).join(', ')}`);
        }

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
            registerResponse = await batch.send(new RegisterJobDefinitionCommand(jobDefContents));
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
            core.info(`Retrieving all job definition revisions for ${jobDefName}`);

            // Get all ACTIVE job definition revisions
            const describeResponse = await batch.send(new DescribeJobDefinitionsCommand({
                jobDefinitionName: jobDefName,
                status: 'ACTIVE'
            }));

            // Filter out the latest revision and definitions with excluded tags
            const oldDefinitions = describeResponse.jobDefinitions.filter(def => {
                // Keep the latest revision
                if (def.revision === revision) {
                    return false;
                }

                // Check if this definition has any excluded tags (matching both key and value)
                if (excludeTags.length > 0 && def.tags) {
                    const hasExcludedTag = excludeTags.some(excludeTag =>
                        def.tags[excludeTag.key] === excludeTag.value
                    );
                    if (hasExcludedTag) {
                        core.info(`Skipping deregistration of ${def.jobDefinitionName}:${def.revision} (has excluded tag)`);
                        return false;
                    }
                }

                return true;
            });

            if (oldDefinitions.length > 0) {
                core.info(`Found ${oldDefinitions.length} old job definition revisions to deregister`);

                // Deregister each old revision
                for (const oldDef of oldDefinitions) {
                    core.info(`Deregistering old definition ${oldDef.jobDefinitionName}:${oldDef.revision}`);
                    await batch.send(new DeregisterJobDefinitionCommand({
                        jobDefinition: `${oldDef.jobDefinitionName}:${oldDef.revision}`
                    }));
                }
            } else {
                core.info(`No old definitions to deregister for ${jobDefName}`);
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
