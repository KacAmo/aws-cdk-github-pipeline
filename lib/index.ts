#!/usr/bin/env node
import {CdkPipeline, SimpleSynthAction} from '@aws-cdk/pipelines';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import {App, Construct, SecretValue, Stack, Stage} from "@aws-cdk/core/lib";

export interface CdkGithubPipelineProps {
    buildCommands: string[];
    installCommands: string[];
    projectName: string,
    githubProjectOwner: string
    stages: {
        account: string,
        region: string
    }[]
}

export abstract class CdkGithubPipeline extends Construct {
    private cdkPipeline: CdkPipeline;

    protected constructor(app: App, pipelineStack: Stack, id: string, props: CdkGithubPipelineProps) {
        super(app, id);

        const sourceArtifact = new codepipeline.Artifact();
        const cloudAssemblyArtifact = new codepipeline.Artifact();

        const buildCommands: string[] = ["npm install aws-cdk"];
        Array.prototype.push.apply(buildCommands, props.buildCommands);

        this.cdkPipeline = new CdkPipeline(pipelineStack, 'Pipeline', {
            pipelineName: `${props?.projectName}-pipeline`,
            cloudAssemblyArtifact,

            sourceAction: new codepipeline_actions.GitHubSourceAction({
                actionName: 'GitHub',
                output: sourceArtifact,
                oauthToken: SecretValue.secretsManager('GITHUB_TOKEN'),
                owner: props.githubProjectOwner,
                repo: props.projectName,
            }),

            synthAction: new SimpleSynthAction({
                sourceArtifact,
                cloudAssemblyArtifact,
                installCommands: props.installCommands,
                buildCommands: props.buildCommands,
                synthCommand: 'npx cdk synth',
                subdirectory: 'deployment'
            })

        });

        props.stages.forEach(stage => {
            this.cdkPipeline.addApplicationStage(this.createStage({
                pipelineStack: pipelineStack,
                ...stage
            }))
        })
    }

    protected abstract createStage(stageEnvironment: {
        pipelineStack: Stack,
        account: string,
        region: string
    }): Stage;
}

