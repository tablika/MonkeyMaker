var property = require("./property.js");

module.exports.evaluate = evaluate;

function evaluate(configTemplate, actualConfig, prefix) {

  actualConfig = actualConfig || {};

  var valid = true;
  var errors = [];
  var config = {};

  for(var key in configTemplate) {
    if(typeof(configTemplate[key]) == "object") {
      // if it's an object then, recursively search through it.
      var results = evaluate(configTemplate[key], actualConfig[key], (prefix ? prefix + "." : "") + key);
      if(!results.isValid)
        errors = errors.concat(results.errors);
      else
        config[key] = results.config;

      valid = valid && results.isValid;
    }
    else {
      var results = getPropertyValidationResult(configTemplate[key], actualConfig[key]);
      if(!results.isValid){
        delete results.isValid;
        results.keyPath = (prefix ? prefix + "." : "") + key;
        errors.push(results);
        valid = false;
      } else {
        config[key] = {value: results.value, key: results.key, name: results.name};
      }
    }
  }
  return {isValid: valid, errors: (errors.length==0?null:errors), config: config};
}

var getPropertyValidationResult = function(propertyExpression, value) {

  var type = propertyExpression.split(".")[0];
  var code = "var " + type + "= new property(type, value);";
  return eval(code + propertyExpression + ".evaluate()");

}
