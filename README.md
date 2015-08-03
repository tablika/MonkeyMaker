# MonkeyMaker.js
A Node.js library to easily create multiple configs for your Xamarin.iOS and Xamarin.Android projects.

[npm-url]: https://npmjs.org/package/monkey-maker
[downloads-image]: http://img.shields.io/npm/dm/monkey-maker.svg
[npm-image]: http://img.shields.io/npm/v/monkey-maker.svg

[![GitHub license](https://img.shields.io/github/license/mashape/apistatus.svg)]()
[![NPM version][npm-image]][npm-url] [![Downloads][downloads-image]][npm-url]

## Installation

```bash
$ npm install monkey-maker --save
```

## What is MonkeyMaker?

MonkeyMaker is a Node.js package that would let you easily create deployment jobs similar to what a Makfile does but easier and of course in your favorite language, JavaScript. MonkeyMaker already comes with white-labeling tools making it a piece of cake to rebrand your app, change settings and deploy. The focus is on mobile platforms but it can extend to any compiler and any platform that can execute a Node.js app.

Specifically, MonkeyMaker ships with support for Xamarin's iOS and Android project but you can plug in your own builder and perform your own logic.

Through EventHandlers, you can perform your custom tasks at any event you'd like. For more info, see **EventHandler** documentation.

Through ArtifactProcessors, you can process the generated binary. A very common case scenario is to upload it somewhere, there is already an integration for HockeyApp and iTunesConnect. This way, you can simply plug in iTC Artifact Processor and make it a real Continuous Integration, a real automated deployment that builds and deploys to Test Flight for example without the need of any manual work.

Focus of MonkeyMaker is on extensibility. Everyone has its own needs, MonkeyMaker allows you to plug in event handlers and artifact processors to add any step you want and share it with the rest of the world so they can use it easily as well.

Let's talk code!

You always need a Monkey project settings. You pass these settings to Monkey to create an instance of Monkey. It's recommended that you keep these settings in a file. Like monkey.json.

```JavaScript
var Monkey = require('monkey-maker');

var monkeyOptions = {
  project: {
    solutionPath: "/path/to/solution/file.sln"
  }
};
var myMonkey = new Monkey(monkeyOptions);
```

The only required field for Monkey is "project.solutionPath". However, depending on your needs, you may need to add other fields as well. For example, for iTunedConnect integration, you will need to plug in your user name and password. Note that this is shared with EventHandlers and ArtifactProcessors so if you have your own plug-in, your plug-in has access to these project settings and can require its own parameters.

For building your iOS project, simply write the following:
```JavaScript
var Monkey = require('monkey-maker');

var monkeyOptions = {
  project: {
    solutionPath: "/path/to/solution/file.sln"
  },
  ios: {
    projectName: "MyProjectName"
  }
};
var myMonkey = new Monkey(monkeyOptions);
var results = myMonkey.build('Debug', 'ios');
console.log(results);
```

For more detailed documentation, checkout the Wiki.

# Community
Google Groups: https://groups.google.com/a/tablika.com/forum/?hl=en#!forum/developer-community

# Tasks
- [ ] A good documentation.
- [X] Create plist property if it doesn't exist.
- [X] Default key.
- [ ] Custom key name for objects
- [ ] Hierarchical object representation in the property list files and the XML files (it's flat right now).
- [ ] Grunt support
