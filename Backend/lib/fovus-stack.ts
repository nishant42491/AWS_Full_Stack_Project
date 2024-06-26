import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';


export class FovusStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //S3 bucket
    const bucket = new s3.Bucket(this, 'FovusBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //DynamoDB table
    const table = new dynamodb.Table(this, 'FileTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE
    });



    const lambdaFunction = new lambda.Function(this, 'LambdaHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        TABLE_NAME: table.tableName
      }
    });

    const presignedUrlLambda = new lambda.Function(this, 'PresignedUrlLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('presigned-url-lambda'),
      environment: {
        REGION: this.region,
        BUCKET_NAME: bucket.bucketName
      }
    });

    //permissions
    bucket.grantReadWrite(lambdaFunction);
    bucket.grantReadWrite(presignedUrlLambda);
    table.grantReadWriteData(lambdaFunction);

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:*'],
      resources: ['*'],
    }));
    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:*'],
      resources: ['*'],
    }));

    //api gateway
    const api = new apigateway.LambdaRestApi(this, 'APIGateway', {
      handler: lambdaFunction
    });

    const presignedApi = new apigateway.LambdaRestApi(this, 'PresignedAPIGateway', {
      handler: presignedUrlLambda,
      proxy: false
    });

    const presignedResource = presignedApi.root.addResource('presigned-url');
    presignedResource.addMethod('POST', new apigateway.LambdaIntegration(presignedUrlLambda));



    const streamHandler = new lambda.Function(this, 'StreamHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'stream.handler',
      code: lambda.Code.fromAsset('stream-lambda'),
      role: lambdaRole,
      environment: {
        TABLE_NAME: table.tableName
      },
      timeout: cdk.Duration.seconds(300)
    });



    streamHandler.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2FullAccess'));


    streamHandler.addEventSource(new DynamoEventSource(table, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON
    }));


  }
}
