module.exports = function(typeName, value) {

  this.isValid = true;
  this.type = typeName;
  this.value = value;
  this.isOptional = false;

  return this;

}

module.exports.prototype.default = function(defaultValue) {
  this.value = this.value || defaultValue;
  return this;
}

module.exports.prototype.optional = function() {
  this.isOptional = true;
  this.value = this.value || null;
  return this;
}

module.exports.prototype.evaluate = function() {

  // See if it's invalidated.
  if(!this.isValid)
    return {
      isValid: this.isValid, // which is false
      message: this.message || "value is not valid."
    };

  // if it's optional and no value is provided, then just return null.
  if(this.isOptional && (this.value == null || this.value == undefined))
    return {
      isValid: true,
      value: null
    };

  // if it's null but not optional, then it's invalid.
  if(!this.isOptional && (this.value == null || this.value == undefined))
    return {
      isValid: false,
      message: "this property is required."
    };

  // See if types match.
  if(typeof(this.value) != this.type)
    return {
      isValid: false,
      message: "type mismatch, " + this.value + " is not of type: " + this.type
    };

  return { isValid: true, value: this.value };

}
