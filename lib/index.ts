#!/usr/bin/env node
import {CdkPipeline, SimpleSynthAction} from '@aws-cdk/pipelines';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import {App, Construct, SecretValue, Stack, Stage} from "@aws-cdk/core/lib";

export interface CdkGithubPipelineProps {
    buildCommands?: string[];
    installCommands?: string[];
    projectName: string,
    githubProjectOwner: string
    stages: {
        name: string
        account: string,
        region: string
    }[],
    subdir?: string
}

export abstract class CdkGithubPipeline extends Construct {
    private cdkPipeline: CdkPipeline;

    protected constructor(app: App, pipelineStack: Stack, id: string, props: CdkGithubPipelineProps) {
        super(app, id);

        const sourceArtifact = new codepipeline.Artifact();
        const cloudAssemblyArtifact = new codepipeline.Artifact();

        const buildCommands: string[] = ["npm install aws-cdk"];
        if (props.buildCommands) Array.prototype.push.apply(buildCommands, props.buildCommands);

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
                subdirectory: CdkGithubPipeline.notEmptyString(props.subdir) ? props.subdir : "."
            })

        });

        props.stages.forEach(stageParams => {
            const stageEnv = {
                region: stageParams.region,
                account: stageParams.account
            };
            const stage = new Stage(pipelineStack, stageParams.name, {
                env: stageEnv
            });
            this.createStacks({
                stageScope: stage,
                ...stageEnv
            })
            this.cdkPipeline.addApplicationStage(stage)
        })
    }

    private static notEmptyString(stringToTest: string | undefined) {
        return stringToTest && stringToTest.length > 0;
    }

    protected abstract createStacks(stageEnvironment: {
        stageScope: Stage,
        account: string,
        region: string
    }): Stack[];
}

