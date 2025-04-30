// Importing AWS SDK v3 modules
const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { EC2Client, RunInstancesCommand, DescribeInstancesCommand, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto'); // To generate unique hash or timestamp

const dynamodb = new DynamoDBClient({ region: 'ap-south-1' });
const ec2 = new EC2Client({ region: 'ap-south-1' });
const s3 = new S3Client({ region: 'ap-south-1' });

exports.handler = async (event) => {
    try {
        const { Records } = event;

        for (const record of Records) {
            if (record.eventName === 'INSERT') {
                const { input_text, input_file_path } = record.dynamodb.NewImage;
                const inputText = input_text.S;
                const parts = input_file_path.S.split('/');
                const bucketName = parts[0];
                const userFolder = parts[1];
                const fileName = parts[2];

                const uniqueIdentifier = crypto.randomUUID(); // Generate unique identifier
                const instanceId = await createEC2Instance(bucketName, userFolder, fileName, inputText, uniqueIdentifier);

                // Wait for file replacement
                await waitForFileReplacement(bucketName, `${userFolder}/output.txt`, uniqueIdentifier);

                await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));

                await updateDynamoDBRecord(record.dynamodb.Keys.id.S, instanceId, userFolder, bucketName);
            }
        }

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: 'Success' })
        };
    } catch (error) {
        console.error('Error processing DynamoDB event:', error);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ error: 'Error processing request' })
        };
    }
};

async function createEC2Instance(bucketName, userFolder, fileName, inputText, uniqueIdentifier) {
    console.log('Bucket Name:', bucketName);
    console.log('User Folder:', userFolder);
    console.log('File Name:', fileName);

    const charCount = inputText.length;

    // User data script that includes character count
    const userDataScript = `
    #!/bin/bash
    aws s3 cp s3://${bucketName}/${userFolder}/${fileName} /home/ec2-user/inputFile.txt
    echo " ${charCount} " >> /home/ec2-user/inputFile.txt
    aws s3 cp /home/ec2-user/inputFile.txt s3://${bucketName}/${userFolder}/output.txt --metadata unique-id=${uniqueIdentifier}
    `;

    const params = {
        ImageId: "ami-0d3e89b21bfdcc33e",
        InstanceType: 't2.micro',
        MinCount: 1,
        MaxCount: 1,
        UserData: Buffer.from(userDataScript).toString('base64'),
        IamInstanceProfile: {
            Name: "ec2-ssm" // Replace with the appropriate IAM instance profile
        },
        TagSpecifications: [
            {
                ResourceType: 'instance',
                Tags: [
                    { Key: 'Name', Value: 'DynamoDBProcessor' }
                ]
            }
        ]
    };

    const data = await ec2.send(new RunInstancesCommand(params));
    const instanceId = data.Instances[0].InstanceId;

    await waitForInstanceRunning(instanceId);

    return instanceId;
}

async function waitForInstanceRunning(instanceId) {
    while (true) {
        const params = {
            InstanceIds: [instanceId]
        };
        const data = await ec2.send(new DescribeInstancesCommand(params));
        const instanceState = data.Reservations[0].Instances[0].State.Name;
        if (instanceState === 'running') {
            console.log('Instance is now running.');
            break;
        }
        console.log(`Instance state is ${instanceState}, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

async function waitForFileReplacement(bucketName, fileKey, uniqueIdentifier) {
    while (true) {
        try {
            const data = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: fileKey }));
            if (data.Metadata && data.Metadata['unique-id'] === uniqueIdentifier) {
                console.log('New file uploaded successfully');
                break;
            } else {
                console.log('File not replaced yet, waiting...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } catch (error) {
            if (error.name === 'NotFound') {
                console.log('File not uploaded yet, waiting...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                throw error;
            }
        }
    }
}

async function updateDynamoDBRecord(id, instanceId, userFolder, bucketName) {
    const outputFileUrl = `s3://${bucketName}/${userFolder}/output.txt`;

    const params = {
        TableName: process.env.TABLE_NAME,
        Key: { id: { S: id } },
        UpdateExpression: 'SET instanceId = :val, outputFileUrl = :url',
        ExpressionAttributeValues: {
            ':val': { S: instanceId },
            ':url': { S: outputFileUrl }
        }
    };

    await dynamodb.send(new UpdateItemCommand(params));
}
