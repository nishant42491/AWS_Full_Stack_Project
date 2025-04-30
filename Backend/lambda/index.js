const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");

// Creating DynamoDB client instance
const dynamodb = new DynamoDBClient({ region: 'ap-south-1' });

exports.handler = async (event) => {
    try {
        const { nanoid } = await import('nanoid');

        // Log the event
        console.log("Event:", event);
        const { inputText, inputFile } = JSON.parse(event.body);
        console.log("Parsed input:", inputText, inputFile);
        const id = nanoid();
        const bucketName = process.env.BUCKET_NAME;
        console.log("Bucket name:", bucketName);

        // Assuming inputFile contains the S3 key
        const inputFilePath = `${bucketName}/${inputFile}`;

        // Store data in DynamoDB without marshalling
        const params = {
            TableName: process.env.TABLE_NAME,
            Item: {
                id: { S: id },
                input_text: { S: inputText },
                input_file_path: { S: inputFilePath }
            }
        };
        await dynamodb.send(new PutItemCommand(params));

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Data stored successfully',
                id: id
            })
        };
    } catch (error) {
        console.error('Error processing request:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error processing request',
                error: error.message
            })
        };
    }
};
