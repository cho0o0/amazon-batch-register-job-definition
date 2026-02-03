// Mock fs before requiring other modules
const mockExistsSync = jest.fn(() => true);
jest.mock('fs', () => {
    const originalFs = jest.requireActual('fs');
    return {
        ...originalFs,
        existsSync: mockExistsSync,
    };
});

// Mock @actions/core
const mockSetOutput = jest.fn();
const mockSetFailed = jest.fn();
const mockInfo = jest.fn();
const mockDebug = jest.fn();
const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();

jest.mock('@actions/core', () => ({
    getInput: (...args) => mockGetInput(...args),
    getBooleanInput: (...args) => mockGetBooleanInput(...args),
    setOutput: (...args) => mockSetOutput(...args),
    setFailed: (...args) => mockSetFailed(...args),
    info: (...args) => mockInfo(...args),
    debug: (...args) => mockDebug(...args),
}));

// Mock AWS SDK
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-batch', () => {
    return {
        BatchClient: jest.fn(() => ({
            send: mockSend
        })),
        RegisterJobDefinitionCommand: jest.fn((params) => ({ type: 'register', params })),
        DescribeJobDefinitionsCommand: jest.fn((params) => ({ type: 'describe', params })),
        DeregisterJobDefinitionCommand: jest.fn((params) => ({ type: 'deregister', params }))
    };
});

describe('Amazon Batch Register Job Definition', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Default input mocks
        mockGetInput.mockImplementation((name) => {
            if (name === 'job-definition') return 'job-definition.json';
            if (name === 'deregister-old-definition-exclude-tags') return '';
            return '';
        });
        mockGetBooleanInput.mockReturnValue(false);

        process.env = Object.assign(process.env, { GITHUB_WORKSPACE: __dirname });

        mockExistsSync.mockReturnValue(true);

        jest.doMock('./job-definition.json', () => ({
            jobDefinitionName: 'test-job',
            type: 'container',
            containerProperties: {
                image: 'some-image'
            }
        }), { virtual: true });

        // Default mock for send
        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:1',
                    jobDefinitionName: 'test-job',
                    revision: 1
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1 }
                    ]
                });
            }
            if (command.type === 'deregister') {
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
    });

    afterEach(() => {
        jest.resetModules();
    });

    test('registers the job definition contents', async () => {
        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSetOutput).toHaveBeenNthCalledWith(1, 'job-definition-arn', 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:1');
        expect(mockSetOutput).toHaveBeenNthCalledWith(2, 'job-definition-name', 'test-job');
        expect(mockSetOutput).toHaveBeenNthCalledWith(3, 'revision', 1);
    });

    test('fails when job definition file does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledWith('Job definition file does not exist: job-definition.json');
    });

    test('fails when AWS registration fails', async () => {
        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.reject(new Error('AWS error'));
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledWith('Failed to register job definition with Batch: AWS error');
    });

    test('deregisters old definitions when enabled', async () => {
        mockGetBooleanInput.mockReturnValue(true);

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:3',
                    jobDefinitionName: 'test-job',
                    revision: 3
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1 },
                        { jobDefinitionName: 'test-job', revision: 2 },
                        { jobDefinitionName: 'test-job', revision: 3 }
                    ]
                });
            }
            if (command.type === 'deregister') {
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Should call: 1 register + 1 describe + 2 deregister (revisions 1 and 2)
        expect(mockSend).toHaveBeenCalledTimes(4);
        expect(mockInfo).toHaveBeenCalledWith('Found 2 old job definition revisions to deregister');
        expect(mockInfo).toHaveBeenCalledWith('Deregistering old definition test-job:1');
        expect(mockInfo).toHaveBeenCalledWith('Deregistering old definition test-job:2');
    });

    test('skips deregistration when no old definitions exist', async () => {
        mockGetBooleanInput.mockReturnValue(true);

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:1',
                    jobDefinitionName: 'test-job',
                    revision: 1
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1 }
                    ]
                });
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Should call: 1 register + 1 describe, no deregister
        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(mockInfo).toHaveBeenCalledWith('No old definitions to deregister for test-job');
    });

    test('excludes definitions with specified tags from deregistration', async () => {
        mockGetBooleanInput.mockReturnValue(true);
        mockGetInput.mockImplementation((name) => {
            if (name === 'job-definition') return 'job-definition.json';
            if (name === 'deregister-old-definition-exclude-tags') return 'keep-alive:true, production:us-east-1';
            return '';
        });

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:4',
                    jobDefinitionName: 'test-job',
                    revision: 4
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1, tags: { 'keep-alive': 'true' } },
                        { jobDefinitionName: 'test-job', revision: 2, tags: { 'production': 'us-east-1' } },
                        { jobDefinitionName: 'test-job', revision: 3, tags: { 'environment': 'staging' } },
                        { jobDefinitionName: 'test-job', revision: 4 }
                    ]
                });
            }
            if (command.type === 'deregister') {
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Should call: 1 register + 1 describe + 1 deregister (only revision 3)
        expect(mockSend).toHaveBeenCalledTimes(3);
        expect(mockInfo).toHaveBeenCalledWith('Skipping deregistration of test-job:1 (has excluded tag)');
        expect(mockInfo).toHaveBeenCalledWith('Skipping deregistration of test-job:2 (has excluded tag)');
        expect(mockInfo).toHaveBeenCalledWith('Found 1 old job definition revisions to deregister');
        expect(mockInfo).toHaveBeenCalledWith('Deregistering old definition test-job:3');
    });

    test('handles definitions without tags when exclude tags are specified', async () => {
        mockGetBooleanInput.mockReturnValue(true);
        mockGetInput.mockImplementation((name) => {
            if (name === 'job-definition') return 'job-definition.json';
            if (name === 'deregister-old-definition-exclude-tags') return 'keep-alive:true';
            return '';
        });

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:3',
                    jobDefinitionName: 'test-job',
                    revision: 3
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1 }, // no tags
                        { jobDefinitionName: 'test-job', revision: 2, tags: {} }, // empty tags
                        { jobDefinitionName: 'test-job', revision: 3 }
                    ]
                });
            }
            if (command.type === 'deregister') {
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Should deregister both revisions 1 and 2 (neither has the excluded tag)
        expect(mockSend).toHaveBeenCalledTimes(4);
        expect(mockInfo).toHaveBeenCalledWith('Found 2 old job definition revisions to deregister');
    });

    test('does not deregister when deregister option is false', async () => {
        mockGetBooleanInput.mockReturnValue(false);

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:2',
                    jobDefinitionName: 'test-job',
                    revision: 2
                });
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Should only call register, not describe or deregister
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('logs excluded tag key:value pairs when provided', async () => {
        mockGetInput.mockImplementation((name) => {
            if (name === 'job-definition') return 'job-definition.json';
            if (name === 'deregister-old-definition-exclude-tags') return 'keep-alive:true, production:us-east-1';
            return '';
        });

        const run = require('./index');
        await run();

        expect(mockInfo).toHaveBeenCalledWith('Tag key:value pairs that will exclude definitions from deregistration: keep-alive:true, production:us-east-1');
    });

    test('handles invalid exclude tags format gracefully', async () => {
        mockGetBooleanInput.mockReturnValue(true);
        mockGetInput.mockImplementation((name) => {
            if (name === 'job-definition') return 'job-definition.json';
            if (name === 'deregister-old-definition-exclude-tags') return '   ,  , invalid, :nokey, novalue:';
            return '';
        });

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:2',
                    jobDefinitionName: 'test-job',
                    revision: 2
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1 },
                        { jobDefinitionName: 'test-job', revision: 2 }
                    ]
                });
            }
            if (command.type === 'deregister') {
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Invalid format tags should be filtered out, so revision 1 should be deregistered
        expect(mockSend).toHaveBeenCalledTimes(3);
    });

    test('deregisters when tag key matches but value differs', async () => {
        mockGetBooleanInput.mockReturnValue(true);
        mockGetInput.mockImplementation((name) => {
            if (name === 'job-definition') return 'job-definition.json';
            if (name === 'deregister-old-definition-exclude-tags') return 'keep-alive:true';
            return '';
        });

        mockSend.mockImplementation((command) => {
            if (command.type === 'register') {
                return Promise.resolve({
                    jobDefinitionArn: 'arn:aws:batch:us-east-1:123456789:job-definition/test-job:2',
                    jobDefinitionName: 'test-job',
                    revision: 2
                });
            }
            if (command.type === 'describe') {
                return Promise.resolve({
                    jobDefinitions: [
                        { jobDefinitionName: 'test-job', revision: 1, tags: { 'keep-alive': 'false' } }, // key matches but value differs
                        { jobDefinitionName: 'test-job', revision: 2 }
                    ]
                });
            }
            if (command.type === 'deregister') {
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const run = require('./index');
        await run();

        expect(mockSetFailed).toHaveBeenCalledTimes(0);
        // Revision 1 should be deregistered because value doesn't match
        expect(mockSend).toHaveBeenCalledTimes(3);
        expect(mockInfo).toHaveBeenCalledWith('Deregistering old definition test-job:1');
    });
});
