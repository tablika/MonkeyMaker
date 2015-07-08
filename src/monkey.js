var configUtil = require('./config.js');
var fs = require('fs');
var uuid = require('node-uuid');          // Unique id generator.
var format = require('string-format');    // String formatting
var path = require('path');               // Path utilities

format.extend(String.prototype);

module.exports = Monkey;

function Monkey(options) {

  this.options = options || { };
  this.configUtil = configUtil;
  this.eventHandlers = [];
  this.artifactProcessors = [];
  this.builders = {
    'ios': require('./builders/ios.js'),
    'android': require('./builders/android.js')
  };

}

Monkey.prototype.useEventHandler = function(eventHandler) {
  this.eventHandlers.push(eventHandler);
};

Monkey.prototype.useArtifactProcessor = function(artifactProcessor) {
  this.artifactProcessors.push(artifactProcessor);
}

Monkey.prototype.postEvent = function(event, args) {
  for (var i = 0; i < this.eventHandlers.length; i++) {
    if(this.eventHandlers[i][event])
      this.eventHandlers[i][event](args);
  }
};

Monkey.prototype.build = function(target, platform, outputPath) {

  var builder = this.getBuilder(platform);
  return builder.build(target, outputPath);
};

Monkey.prototype.installConfig = function(configName, platform) {

  var builder = this.getBuilder(platform);
  return builder.installConfig(configName);
};

Monkey.prototype.uploadToHockeyApp = function(appUrl, hockeyAppId, releaseNotesPath) {

  var hockeyAppConfig = configUtil.evaluate({apiKey: "string"}, this.options.hockeyApp);
  releaseNotesPath = releaseNotesPath ? '-notes_path="{0}"'.format(releaseNotesPath) : '';

  var execResult = exec('puck -api_token={0} -app_id={1} -submit=auto -download=true -open=notify -notify=false {2} {3}'
      .format(hockeyAppConfig.apiKey.value, hockeyAppId, releaseNotesPath, appUrl));

  return { success: execResult.status == 0, stdout: execResult.stdout, stderr: execResult.stderr };
};

Monkey.prototype.deploy = function (deployParams) {

  var deployParams = configUtil.evaluate({configs: "object", platforms: "object", store_release: "bool.default(false)"}, deployParams);
  if(!deployParams.isValid) throw {errors: deployParams.errors, message: "deployParams is not valid."};
  deployParams = deployParams.config;

  var projectSettings = configUtil.evaluate({outputPath: "string.default('output')", solutionPath: "string"}, this.options.project);
  if(!projectSettings.isValid) throw { errors: projectSettings.errors, message: "Monkey build project settings are not valid."};
  projectSettings = projectSettings.config;

  var job = {
    id: uuid.v4(),
    configs: deployParams.configs.value,
    platforms: deployParams.platforms.value,
    isFinished: false,
    currentBuildConfig: null,
    lastUpdate: "Initializing",
    status: {
      successfulConfigs: [],
      failedConfigs: [],
      successful: 0,
      failed: 0,
      remaining: deployParams.configs.value.length,
      total: deployParams.configs.value.length
    },
    results: {}
  };

  this.postEvent('willStartJob', job);

  var configIndex = 1;
  for (var i = 0; i < deployParams.configs.value.length; i++) {
    var config = deployParams.configs.value[i]
    for (var i = 0; i < deployParams.platforms.value.length; i++) {
      var platform = deployParams.platforms.value[i];
      var configDeployResults = { status: "Running", completedTasks: [] };
      if(!job.results.hasOwnProperty(config)) job.results[config] = {};
      job.results[config][platform] = configDeployResults;

      try {
        job.currentBuildConfig = config;
        job.lastUpdate = "Preparing for config '{0}'" ;
        this.postEvent('willStartConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});
        var currentTask = "Preparing";

        // Step 1: Install the config.
        this.postEvent('willInstallConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});
        currentTask = "Install Config";
        configDeployResults.status = "Installing Config";
        var configInstallationResults = this.installConfig(config, platform);
        configDeployResults.completedTasks.push(currentTask);
        this.postEvent('didInstallConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id, configs: configInstallationResults.configs });

        // Step 2: Build the project.
        this.postEvent('willBuildConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});
        currentTask = "Build Project";
        configDeployResults.status = "Building Project";
        var outputPath = resolvePath(path.dirname(projectSettings.solutionPath.value), projectSettings.outputPath.value);
        outputPath = path.join(outputPath, config, platform);
        var buildResults = this.build(deployParams.store_release.value?'AppStore':'Release', platform, outputPath);
        if(!buildResults.success) throw buildResults;
        configDeployResults.completedTasks.push(currentTask);
        this.postEvent('didBuildConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});

        // Step 3: Process Artifacts
        for (var i = 0; i < this.artifactProcessors.length; i++) {
          var currentArtifactProcessor = this.artifactProcessors[i];
          if(currentArtifactProcessor.supports(platform)) {
            this.postEvent('willProcessArtifact', {configName: config, index: configIndex, platform: platform, jobId: job.id, artifactProcessorName: currentArtifactProcessor.name});
            currentTask = "Process Artifact ({0})".format(currentArtifactProcessor.name);
            configDeployResults.status = "Processing Artifact ({0})".format(currentArtifactProcessor.name);
            var results = currentArtifactProcessor.process({outputUrl: buildResults.outputUrl, configName: config, platform: platform});
            if(!results.success) throw results;
            configDeployResults.completedTasks.push(currentTask);
            this.postEvent('didProcessArtifact', {configName: config, index: configIndex, platform: platform, jobId: job.id, artifactProcessorName: currentArtifactProcessor.name});
          }
        }

        // Report the successful results.
        job.status.successful++;
        job.status.remaining--;
        job.status.successfulConfigs.push(config);
        configDeployResults.status = "Successful";
        configDeployResults.error = null;
        this.postEvent('didFinishConfig', {configName: config, platform: platform, jobId: job.id, index: configIndex, results: configDeployResults});

      } catch (exception) {
        // Update job
        job.status.failed++;
        job.status.remaining--;
        job.status.failedConfigs.push(config);
        // Update deploy results and post an event.
        configDeployResults.status= "Failed";
        configDeployResults.error= exception;
        configDeployResults.failedOn= currentTask;
        this.postEvent('didFailConfig', {error: exception, jobId: job.id, configName: config, index: configIndex, platform: platform, results: configDeployResults});
      }
    }
    configIndex++;
  }
  // Process the job.
  job.isFinished= true;
  job.currentBuildConfig= null;
  job.lastUpdate= "Job {0}!".format(job.status.failed>0?'Failed':'Succeeded');
  this.postEvent('didFinishJob', job);
  return job;
};

Monkey.prototype.getBuilder = function(platform) {
  var builderClass = this.builders[platform.toLowerCase()];
  if(!builderClass) throw { message: "Unsupported platform." };

  return new builderClass(this);
}

function resolvePath(prefix, directoryPath) {
  if(path.isAbsolute(directoryPath)) return directoryPath;
  return path.join(prefix, directoryPath);
}
