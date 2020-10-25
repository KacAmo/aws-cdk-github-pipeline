#!/usr/bin/env node
import {CdkPipeline, SimpleSynthAction} from '@aws-cdk/pipelines';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import {Construct, SecretValue, Stack, StackProps, Stage} from "@aws-cdk/core/lib";

export interface CdkGithubPipeline extends StackProps {
    buildCommands: string[];
    installCommands: string[];
    projectName: string,
    githubProjectOwner: string
    stages: {
        stageName: string,
        stage: {
            account: string,
            region: string
        }
    }[]
}

export abstract class CdkGithubPipeline extends Construct {
    private cdkPipeline: CdkPipeline;

    protected constructor(scope: Construct, id: string, props: CdkGithubPipeline) {
        super(scope, id);

        const sourceArtifact = new codepipeline.Artifact();
        const cloudAssemblyArtifact = new codepipeline.Artifact();

        this.cdkPipeline = new CdkPipeline(this, 'Pipeline', {
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
                synthCommand: 'cdk synth',
                subdirectory: 'deployment'
            })

        });

        props.stages.forEach(stage => this.cdkPipeline.addApplicationStage(this.createStage(stage.stage)))
    }

    protected abstract createStage(stageEnvironment: {
        account: string,
        region: string
    }): Stage;
}

