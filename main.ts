import { Construct } from "constructs";
import { App, Fn, TerraformStack } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import * as aws from "@cdktf/provider-aws/lib";

import { Vpc } from "./.gen/modules/vpc";
// import { Autoscaling } from "./.gen/modules/autoscaling";
// import { Ecs } from "./.gen/modules/ecs";
import * as docker from "./.gen/providers/docker";
// import * as docker from '@cdktf/provider-docker'
import path = require("path");
// import * as aws_ec2 from "aws-cdk-lib/aws-ec2";
// import { AwsTerraformAdapter } from "@cdktf/aws-cdk";

class pushImageToEcr extends Construct {
  public image: docker.registryImage.RegistryImage
  constructor(scope: Construct, id: string, name: string, dockerfile: string) {
    super(scope, id);

    const registry = new aws.ecrRepository.EcrRepository(this, "registry", {
      name: name,
    });

    const localImage = new docker.image.Image(this, "image", {
      name: registry.repositoryUrl,
      buildAttribute: {
        context: path.join(__dirname),
        dockerfile,
      }
    });

    const imageOnEcr = new docker.registryImage.RegistryImage(this, "registryImage", {
      name: localImage.name,
    });

    this.image = imageOnEcr
  }
};

interface serviceProps {
  image: string,
  name: string,
  port: number,
  clusterName: string,
  env: Record<string, string | undefined>
};

class ecsService extends Construct {
  public taskDefinition: aws.ecsTaskDefinition.EcsTaskDefinition;
  public service: aws.ecsService.EcsService;
  constructor(scope: Construct, id: string, props: serviceProps) {
    super(scope, id);

    this.taskDefinition = new aws.ecsTaskDefinition.EcsTaskDefinition(this, "taskDef", {
      cpu: "256",
      memory: "512",
      requiresCompatibilities: ["EC2"],
      family: 'backend',
      containerDefinitions: JSON.stringify([
        {
          name: props.name,
          image: props.name,
          environment: Object.entries(props.env).map(([name, value]) => ({
            name,
            value,
          })),
          portMappings: [{ containerPort: props.port }],
        }
      ]),
    });

    this.service = new aws.ecsService.EcsService(this, "service", {
      name: props.name,
      cluster: props.clusterName,
      taskDefinition: this.taskDefinition.arn,
      desiredCount: 1,
      deploymentMaximumPercent: 200,
      deploymentMinimumHealthyPercent: 100,
      launchType: "EC2",
      schedulingStrategy: "REPLICA",
    })
  }
}


class MyStack extends TerraformStack {

  constructor(scope: Construct, id: string) {
    super(scope, id);

    new AwsProvider(this, "aws", { region: "us-east-1" });

    //  const awsAdapter = new AwsTerraformAdapter(this, "adapter");


    const vpc = new Vpc(this, "vpc", {
      name: "toyful",
      cidr: "10.0.0.0/16",
      azs: ["us-east-1a","us-east-1b"],
      createDatabaseSubnetGroup: true,
      mapPublicIpOnLaunch: true,
      publicSubnets: ["10.0.1.0/24","10.0.2.0/24"],
      privateSubnets: ["10.0.3.0/24","10.0.4.0/24"],
      databaseSubnets: ["10.0.5.0/24","10.0.6.0/24"],
    });

    const token = new aws.dataAwsEcrAuthorizationToken.DataAwsEcrAuthorizationToken(this, "token", {
      registryId: new aws.dataAwsCallerIdentity.DataAwsCallerIdentity(this, 'aws-caller-identity').accountId,
    });

    new docker.provider.DockerProvider(this, "docker", {
      host: "unix:///Users/andrea.spoldi/.colima/default/docker.sock",
      registryAuth: [{
        address: token.proxyEndpoint,
        username: token.userName,
        password: token.password,
      }]
    });

    const backendImage = new pushImageToEcr(this, "toyfulBackend", "backend", "docker/backend.Dockerfile");
    new pushImageToEcr(this, "toyfulFrontend", "frontend", "docker/frontend.Dockerfile");

    const clusterName = "toyful";



    // const amiId = new aws.dataAwsSsmParameter.DataAwsSsmParameter(this, 'ami-id',{
    //   name: "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended",
    // });

    const instaceProfileRole = new aws.iamRole.IamRole(this, "instanceProfileRole", {
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role',
        'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'
      ],
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "ec2.amazonaws.com",
            },
          },
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "ecs.amazonaws.com",
            },
          },
        ],
      }),
    });


    new aws.ecsCluster.EcsCluster(this, 'cluster', {
      name: clusterName,
    });

  const sg = new aws.securityGroup.SecurityGroup(this, "instanceSg", {
      name: "toyful-instance-sg",
      vpcId: vpc.vpcIdOutput,
      ingress: [{
        protocol: "TCP",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"],
      }]
    });

    const userData = Fn.templatefile(path.join(__dirname, "templates/user-data.tpl"), {
      ecs_cluster_name: clusterName,
    })
    const launchTemplateEcs = new aws.launchTemplate.LaunchTemplate(this, "launchTemplate", {
      name: "toyful-launch-template",
      imageId: "ami-0d59d4941a5429c1b",
      instanceType: "t4g.small",
      vpcSecurityGroupIds: [sg.id],
      userData: Fn.base64encode(userData),
      iamInstanceProfile: {
        name: new aws.iamInstanceProfile.IamInstanceProfile(this, "instanceProfile", {
          role: instaceProfileRole.name,
        }).name
      },
    });

    new aws.autoscalingGroup.AutoscalingGroup(this, "autoscaling", {
      name: "toyful-auto-scaling",
      vpcZoneIdentifier: Fn.tolist(vpc.publicSubnetsOutput),
      launchTemplate: {
        id: launchTemplateEcs.id,
        version: '$Latest'
      },
      // protectFromScaleIn: true,
      minSize: 0,
      maxSize: 1,
      desiredCapacity: 1,
    });

    // const capacityProvider = new aws.ecsCapacityProvider.EcsCapacityProvider(this, "capacityProvider", {
    //   name: "toyful-capacity-provider",
    //   autoScalingGroupProvider: {
    //     managedTerminationProtection: "ENABLED",
    //     managedScaling: {
    //       targetCapacity: 1,
    //       minimumScalingStepSize: 1,
    //       maximumScalingStepSize: 1,
    //       status: "ENABLED",
    //     },
    //     autoScalingGroupArn: asg.arn
    //   },
    // });

    new aws.ecsClusterCapacityProviders.EcsClusterCapacityProviders(this, 'cap', {
      clusterName,
      // capacityProviders: [capacityProvider.name],
    });

    new ecsService(this, "backendService", {
      name: "backend",
      image: backendImage.image.name,
      clusterName,
      port: 3000,
      env: {}
    });

    // const executionRoleArn = new aws.iamRole.IamRole(this, "fargateExecutionRole", {
    //   assumeRolePolicy: JSON.stringify({
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: "sts:AssumeRole",
    //         Effect: "Allow",
    //         Sid: "",
    //         Principal: {
    //           Service: "ecs-tasks.amazonaws.com",
    //         },
    //       },
    //     ],
    //   }),
    //   inlinePolicy: [
    //     {
    //       name: "allow-ecr-pull",
    //       policy: JSON.stringify({
    //         Version: "2012-10-17",
    //         Statement: [
    //           {
    //             Effect: "Allow",
    //             Action: [
    //               "ecr:GetAuthorizationToken",
    //               "ecr:BatchCheckLayerAvailability",
    //               "ecr:GetDownloadUrlForLayer",
    //               "ecr:BatchGetImage",
    //               "logs:CreateLogStream",
    //               "logs:PutLogEvents",
    //             ],
    //             Resource: "*",
    //           },
    //         ],
    //       }),
    //     },
    //   ],
    // });

    // const frontendSecurityGroup = new aws.securityGroup.SecurityGroup(this, "frontendSecurityGroup", {
    //   vpcId: vpc.vpcIdOutput,
    //   ingress: [{
    //     protocol: "TCP",
    //     fromPort: 80,
    //     toPort: 80,
    //     cidrBlocks: ["0.0.0.0/0"], 
    //   }]
    // });

    // const backendSecurityGroup = new aws.securityGroup.SecurityGroup(this, "backendSecurityGroup", {
    //   vpcId: vpc.vpcIdOutput,
    //   ingress: [{
    //     protocol: "TCP",
    //     fromPort: 3000,
    //     toPort: 3000,
    //     securityGroups: [frontendSecurityGroup.id],
    //   }]
    // });

    // const dbSecurityGroup = new aws.securityGroup.SecurityGroup(this, "dbSecurityGroup", {
    //   vpcId: vpc.vpcIdOutput,
    //   ingress: [{
    //     protocol: "TCP",
    //     fromPort: 5432,
    //     toPort: 5432,
    //     securityGroups: [backendSecurityGroup.id],
    //   }]
    // });

    // new aws.dbInstance.DbInstance(this, "db", {
    //   storageEncrypted: true,
    //   username: 'root',
    //   instanceClass: "db.t4g.small",
    //   engine: "postgres",
    //   engineVersion: "15",
    //   vpcSecurityGroupIds: [dbSecurityGroup.id],
    //   dbSubnetGroupName: vpc.databaseSubnetGroupOutput,
    //   iamDatabaseAuthenticationEnabled: true,
    //   allocatedStorage: 20,
    // });



    //   new fargateService(this, "backendService", {
    //     clusterName,
    //     vpc,
    //     image: backendImage.image.name,
    //     port: 3000,
    //     family: "backend",
    //     executionRoleArn: executionRoleArn.arn,
    //     name: "backend",
    //     env: {
    //       //  'DB_HOST': Fn.tostring(db.address),
    //       //  'DB_PORT': '5432',
    //       //  'DB_USERNAME': db.username,
    //       //  'DB_PASSWORD': db.password,
    //     } 
    //   });

    // new fargateService(this, "frontendService", {
    //     clusterName,
    //     vpc,
    //     image: frontendImage.image.name,
    //     port: 80,
    //     family: "frontend",
    //     executionRoleArn: executionRoleArn.arn,
    //     name: "frontend",
    //     env: {}
    //   });
  }
}

const app = new App();
new MyStack(app, "toyful");
app.synth();
