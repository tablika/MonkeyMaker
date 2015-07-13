var configUtil = require('./config.js');
var fs = require('fs');
var uuid = require('node-uuid');          // Unique id generator.
var format = require('string-format');    // String formatting
var path = require('path');               // Path utilities
var async = require('asyncawait/async');
var await = require('asyncawait/await');

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
    try {
      if(this.eventHandlers[i][event])
        this.eventHandlers[i][event](args);
    } catch (exception) {
      console.error('Event handler throws error (has no effect on the deployment): ' + exception);
    }
  }
};

Monkey.prototype.build = function(target, platform, outputPath) {

  var builder = this.getBuilder(platform);
  return builder.build(target, outputPath);
};

Monkey.prototype.installConfig = function(configName, platform, overrides) {

  var builder = this.getBuilder(platform);
  return builder.installConfig(configName, overrides);
};

Monkey.prototype.deploy = function (deployParams, callback) {

  var deployParams = configUtil.evaluate({
    configs: "object",
    platforms: "object",
    store_release: "boolean.default(false)",
    version: "string.optional()"
  }, deployParams);

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
      remaining: deployParams.configs.value.length * deployParams.platforms.value.length,
      total: deployParams.configs.value.length * deployParams.platforms.value.length
    },
    results: {}
  };

  var asyncTask = async(function() {
    this.postEvent('willStartJob', job);

    var configIndex = 1;
    for (var i = 0; i < deployParams.configs.value.length; i++) {
      var config = deployParams.configs.value[i]
      for (var j = 0; j < deployParams.platforms.value.length; j++) {
        var platform = deployParams.platforms.value[j];
        var configDeployResults = { status: "Running", completedTasks: [] };
        if(!job.results.hasOwnProperty(config)) job.results[config] = {};
        job.results[config][platform] = configDeployResults;

        try {
          job.currentBuildConfig = config;
          job.lastUpdate = "Preparing for config '{0}'".format(config);
          this.postEvent('willStartConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});
          var currentTask = "Preparing";

          // Step 1: Install the config.
          this.postEvent('willInstallConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});
          currentTask = "Install Config";
          configDeployResults.status = "Installing Config";
          var configInstallationResults = await(this.installConfig(config, platform, {version: deployParams.version.value}));
          configDeployResults.completedTasks.push(currentTask);
          this.postEvent('didInstallConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id, configs: configInstallationResults.configs });

          // Step 2: Build the project.
          this.postEvent('willBuildConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id});
          currentTask = "Build Project";
          configDeployResults.status = "Building Project";
          var outputPath = resolvePath(path.dirname(projectSettings.solutionPath.value), projectSettings.outputPath.value);
          outputPath = path.join(outputPath, config, platform.toLowerCase());
          var buildResults = await(this.build(deployParams.store_release.value?'AppStore':'Release', platform, outputPath));
          if(!buildResults.success) throw buildResults;
          configDeployResults.completedTasks.push(currentTask);
          this.postEvent('didBuildConfig', {configName: config, index: configIndex, platform: platform, jobId: job.id, buildResults: buildResults});

          // Step 3: Process Artifacts
          for (var k = 0; k < this.artifactProcessors.length; k++) {
            var currentArtifactProcessor = this.artifactProcessors[k];
            if(currentArtifactProcessor.supports(platform.toLowerCase())) {
              this.postEvent('willProcessArtifact', {configName: config, index: configIndex, platform: platform, jobId: job.id, artifactProcessorName: currentArtifactProcessor.name});
              currentTask = "Process Artifact ({0})".format(currentArtifactProcessor.name);
              configDeployResults.status = "Processing Artifact ({0})".format(currentArtifactProcessor.name);
              var results = await(currentArtifactProcessor.process({monkey: this, config: configInstallationResults.rawConfig, outputUrl: buildResults.outputUrl, configName: config, platform: platform}));
              if(!results.success) throw results;
              configDeployResults.completedTasks.push(currentTask);
              this.postEvent('didProcessArtifact', {configName: config, index: configIndex, platform: platform, jobId: job.id, artifactProcessorName: currentArtifactProcessor.name});
            }
          }

          // Report the successful results.
          job.status.successful++;
          job.status.remaining--;
          job.status.successfulConfigs.push('{0} ({1})'.format(config, platform.toLowerCase()));
          configDeployResults.status = "Successful";
          configDeployResults.error = null;
          this.postEvent('didFinishConfig', {configName: config, platform: platform, jobId: job.id, index: configIndex, results: configDeployResults});

        } catch (exception) {
          // Update job
          job.status.failed++;
          job.status.remaining--;
          job.status.failedConfigs.push('{0} ({1})'.format(config, platform.toLowerCase()));
          // Update deploy results and post an event.
          configDeployResults.status= "Failed";
          configDeployResults.error= exception;
          configDeployResults.failedOn= currentTask;
          this.postEvent('didFailConfig', {error: exception, jobId: job.id, configName: config, index: configIndex, platform: platform, results: configDeployResults});
        }
        configIndex++;
      }
    }
    // Process the job.
    job.isFinished= true;
    job.currentBuildConfig= null;
    job.lastUpdate= "Job {0}!".format(job.status.failed>0?'Failed':'Succeeded');
    this.postEvent('didFinishJob', job);
    return job;
  }).bind(this);
  asyncTask().then(callback);
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
