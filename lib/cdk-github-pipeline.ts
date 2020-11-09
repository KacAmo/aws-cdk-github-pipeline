#!/usr/bin/env node
import {CdkPipeline, CdkStage, ShellScriptAction, SimpleSynthAction} from '@aws-cdk/pipelines';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import {Artifact} from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import {App, Construct, SecretValue, Stack, Stage} from "@aws-cdk/core/lib";

export interface CdkGithubPipelineProps {
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
        const installCommands: string[] = ["npm install -g aws-cdk ts-node typescript"];
        props?.commands?.installCommands
            ?.forEach(installCommand => installCommands.push(installCommand));


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
                installCommands: installCommands,
                buildCommands: props.commands?.buildCommands,
                synthCommand: 'cdk synth',
                subdirectory: CdkGithubPipeline.notEmptyString(props.subdir) ? props.subdir : "."
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
                pipelineStage.addActions(CdkGithubPipeline.testsActionsBeforeFirstStageDeployment(pipelineStage, sourceArtifact, props.commands.beforeNonProdTestCommands));
                firstStage = false;
            }
            if (stage.stageName == props.stage.prodStageName && props?.commands?.beforeProdTestCommands) {
                pipelineStage.addActions(CdkGithubPipeline.testsActionsBeforeProd(pipelineStage, sourceArtifact, props.commands.beforeProdTestCommands));
            }
        })
    }

    private static testsActionsBeforeFirstStageDeployment(pipelineStage: CdkStage, sourceArtifact: Artifact, testCommands: string[]) {
        return new ShellScriptAction({
            actionName: 'tests',
            runOrder: pipelineStage.nextSequentialRunOrder(),
            additionalArtifacts: [
                sourceArtifact
            ],
            commands: testCommands
        });
    }

    private static testsActionsBeforeProd(pipelineStage: CdkStage, sourceArtifact: Artifact, testCommands: string[]) {
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