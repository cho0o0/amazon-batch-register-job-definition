# Amazon Batch Register Job Definition

A GitHub Action to register AWS Batch job definitions from a JSON file.

## Features

- Register AWS Batch job definitions from a JSON configuration file
- Optionally deregister old job definition revisions automatically
- Protect specific job definitions from deregistration using tag key:value pairs
- Full support for all AWS Batch job definition properties

## Usage

### Basic Usage

```yaml
- name: Register Batch job definition
  uses: cho0o0/amazon-batch-register-job-definition@v1.2.0
  with:
    job-definition: path/to/job-definition.json
```

### With Automatic Deregistration

Automatically deregister all old revisions of the job definition after registering a new one:

```yaml
- name: Register and cleanup old definitions
  uses: cho0o0/amazon-batch-register-job-definition@v1.2.0
  with:
    job-definition: path/to/job-definition.json
    deregister-old-definition: 'true'
```

### Protect Specific Revisions with Tags

Use the `deregister-old-definition-exclude-tags` input to protect job definitions that have specific tag key:value pairs from being deregistered. This is useful for keeping production or important revisions active:

```yaml
- name: Register with selective deregistration
  uses: cho0o0/amazon-batch-register-job-definition@v1.2.0
  with:
    job-definition: path/to/job-definition.json
    deregister-old-definition: 'true'
    deregister-old-definition-exclude-tags: 'keep-alive:true, env:prod'
```

In this example, any job definition revision that has either `keep-alive=true` or `env=prod` tag will be preserved. Both the key and value must match exactly.

### Complete Example Workflow

```yaml
name: Deploy Batch Job

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Register job definition
        id: register-job
        uses: cho0o0/amazon-batch-register-job-definition@v1.2.0
        with:
          job-definition: batch/my-job-definition.json
          deregister-old-definition: 'true'
          deregister-old-definition-exclude-tags: 'keep-alive:true'

      - name: Use job definition outputs
        run: |
          echo "Registered: ${{ steps.register-job.outputs.job-definition-name }}:${{ steps.register-job.outputs.revision }}"
          echo "ARN: ${{ steps.register-job.outputs.job-definition-arn }}"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `job-definition` | Path to the Batch job definition JSON file (relative to workspace or absolute) | Yes | - |
| `deregister-old-definition` | If `true`, all old job definition revisions will be deregistered (except the latest and those with excluded tags) | No | `false` |
| `deregister-old-definition-exclude-tags` | Comma-separated list of tag `key:value` pairs (e.g., `env:prod, keep:true`). Job definitions with any matching tag will NOT be deregistered | No | `""` |

## Outputs

| Output | Description |
|--------|-------------|
| `job-definition-name` | The name of the registered job definition |
| `job-definition-arn` | The full ARN of the registered job definition |
| `revision` | The revision number of the registered job definition |

## Job Definition File Format

The job definition file should be a valid JSON file following the [AWS Batch RegisterJobDefinition API](https://docs.aws.amazon.com/batch/latest/APIReference/API_RegisterJobDefinition.html) format.

### Example Job Definition

```json
{
  "jobDefinitionName": "my-batch-job",
  "type": "container",
  "containerProperties": {
    "image": "my-docker-image:latest",
    "resourceRequirements": [
      { "type": "VCPU", "value": "2" },
      { "type": "MEMORY", "value": "4096" }
    ],
    "command": ["python", "main.py"],
    "environment": [
      { "name": "ENV_VAR", "value": "production" }
    ]
  },
  "tags": {
    "Environment": "production",
    "Team": "data-engineering",
    "keep-alive": "true"
  },
  "retryStrategy": {
    "attempts": 3
  },
  "timeout": {
    "attemptDurationSeconds": 3600
  }
}
```

## Tag-Based Protection

When using `deregister-old-definition: 'true'`, you can protect specific job definition revisions from being deregistered by:

1. Adding tags to your job definition when registering it
2. Specifying those tag `key:value` pairs in `deregister-old-definition-exclude-tags`

### Example: Protecting Production Revisions

```json
{
  "jobDefinitionName": "my-batch-job",
  "type": "container",
  "containerProperties": { ... },
  "tags": {
    "keep-alive": "true",
    "env": "prod"
  }
}
```

```yaml
- uses: cho0o0/amazon-batch-register-job-definition@v1.2.0
  with:
    job-definition: job-definition.json
    deregister-old-definition: 'true'
    deregister-old-definition-exclude-tags: 'keep-alive:true, env:prod'
```

Any revision with `keep-alive=true` OR `env=prod` will be preserved. Both the key and value must match exactly for a tag to be considered a match.

## AWS Permissions

The IAM role or user running this action needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "batch:RegisterJobDefinition",
        "batch:DescribeJobDefinitions",
        "batch:DeregisterJobDefinition"
      ],
      "Resource": "*"
    }
  ]
}
```

For more restrictive permissions, you can limit the `Resource` to specific job definitions:

```json
{
  "Resource": "arn:aws:batch:*:*:job-definition/my-job-prefix-*"
}
```

## Requirements

- Node.js 24 or later (for local development)
- AWS credentials configured (via `aws-actions/configure-aws-credentials` or environment variables)

## Development

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build distribution
npm run package
```

### Running Tests

```bash
# Run all tests with coverage
npm test

# Run only unit tests
npx jest
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run `npm run package` to update the dist folder
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request
