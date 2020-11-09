#!/usr/bin/env node
import {CdkPipeline, CdkStage, ShellScriptAction, SimpleSynthAction} from '@aws-cdk/pipelines';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import {Artifact} from '@aws-cdk/aws-codepipeline';
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

export interface CdkGithubPipelineWithTestsProps {
    commands?: {
        buildCommands?: string[];
        installCommands?: string[];
        beforeProdTestCommands?: string[];
        beforeNonProdTestCommands?: string[];
    }
    projectName: string,
    github: {
        projectOwner: string,
        tokenInSecretManager?: string
    }
    stage: {
        prodStageName?: string,
        stages: {
            name: string
            account: string,
            region: string
        }[],
    }
    subdir?: string
}

export abstract class CdkGithubPipeline extends Construct {
    private cdkPipeline: CdkPipeline;

    protected constructor(app: App, pipelineStack: Stack, id: string, props: CdkGithubPipelineProps) {
        super(app, id);

        const sourceArtifact = new codepipeline.Artifact();
        const cloudAssemblyArtifact = new codepipeline.Artifact();
        const buildCommands: string[] = ["npm install -g aws-cdk ts-node typescript"];

        props
            ?.buildCommands
            ?.forEach(buildCommand => buildCommands.push(buildCommand))

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
                buildCommands: buildCommands,
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

export abstract class CdkGithubPipelineWithTests extends Construct {
    private cdkPipeline: CdkPipeline;

    protected constructor(app: App, pipelineStack: Stack, id: string, props: CdkGithubPipelineWithTestsProps) {
        super(app, id);

        const sourceArtifact = new codepipeline.Artifact();
        const cloudAssemblyArtifact = new codepipeline.Artifact();
        const buildCommands: string[] = ["npm install -g aws-cdk ts-node typescript"];
        if (props?.commands?.buildCommands) Array.prototype.push.apply(buildCommands, props.commands.buildCommands);

        const githubTokenPath = props.github?.tokenInSecretManager || 'GITHUB_TOKEN';


        this.cdkPipeline = new CdkPipeline(pipelineStack, 'Pipeline', {
            pipelineName: `${props?.projectName}-pipeline`,
            cloudAssemblyArtifact,
            sourceAction: new codepipeline_actions.GitHubSourceAction({
                actionName: 'GitHub',
                output: sourceArtifact,
                oauthToken: SecretValue.secretsManager(githubTokenPath),
                owner: props.github.projectOwner,
                repo: props.projectName,
            }),

            synthAction: new SimpleSynthAction({
                sourceArtifact,
                cloudAssemblyArtifact,
                installCommands: props?.commands?.installCommands,
                buildCommands: buildCommands,
                synthCommand: 'npx cdk synth',
                subdirectory: CdkGithubPipelineWithTests.notEmptyString(props.subdir) ? props.subdir : "."
            })

        });
        let firstStage: boolean = true;
        props.stage.stages.forEach(stageParams => {
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
            const pipelineStage = this.cdkPipeline.addApplicationStage(stage);
            if (firstStage && props?.commands?.beforeNonProdTestCommands) {
                pipelineStage.addActions(this.testsActionsBeforeFirstStageDeployment(pipelineStage, sourceArtifact, props.commands.beforeNonProdTestCommands));
                firstStage = false;
            }
            if (stage.stageName == props.stage.prodStageName && props?.commands?.beforeProdTestCommands) {
                pipelineStage.addActions(this.testsActionsBeforeProd(pipelineStage, sourceArtifact, props.commands.beforeProdTestCommands));
            }
        })
    }

    private testsActionsBeforeFirstStageDeployment(pipelineStage: CdkStage, sourceArtifact: Artifact, testCommands: string[]) {
        return new ShellScriptAction({
            actionName: 'tests',
            runOrder: pipelineStage.nextSequentialRunOrder(),
            additionalArtifacts: [
                sourceArtifact
            ],
            commands: testCommands
        });
    }

    private testsActionsBeforeProd(pipelineStage: CdkStage, sourceArtifact: Artifact, testCommands: string[]) {
        return new ShellScriptAction({
            actionName: 'beforeProdTests',
            runOrder: pipelineStage.nextSequentialRunOrder(),
            additionalArtifacts: [
                sourceArtifact
            ],
            commands: testCommands
        });
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