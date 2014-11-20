var Sequelize = require("sequelize")
  , async = require("async")
  , fs = require("fs");

module.exports = (function(){
  var AutoSequelize = function(database, username, password, options) {
    this.sequelize = new Sequelize(database, username, password, options || {});
    this.queryInterface = this.sequelize.getQueryInterface();
    this.options = {};
  }

  AutoSequelize.prototype.run = function(options, callback) {
    var self = this
      , text = {};

    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    options.global = options.global || "Sequelize";
    options.local = options.local || "sequelize";
    options.spaces = options.spaces || false;
    options.indentation = options.indentation || 1;
    options.directory = options.directory || "./models";

    self.options = options;

    this.sequelize.query(this.queryInterface.QueryGenerator.showTablesQuery(), null, {raw: true})
    .then(function(tables){
      var _tables = {};
      var associations = {};
      async.each(tables, function(table, _callback){
        var tableName = Array.isArray(table) ? table[0] : table;
        self.queryInterface.describeTable(tableName)
        .then(function(fields){
          _tables[tableName] = fields;
          // get associations
          self.sequelize.query(self.queryInterface.QueryGenerator.getForeignKeysQuery(tableName, self.sequelize.config.database))
          .then(function(fks){
            if (fks.length > 0) {

              associations[tableName] = fks;
            }
            _callback(null);
          });
        });
      }, function(){
        var tableNames = Object.keys(_tables);
        async.each(tableNames, function(table, _callback){
          var fields = Object.keys(_tables[table])
            , spaces = "";

          for (var x = 0; x < options.indentation; ++x) {
            spaces += (options.spaces === true ? " " : "\t");
          }

          text[table] = "";
          text[table] += "module.exports = function(sequelize, DataTypes) {\n";
          text[table] += spaces + "return sequelize.define(\"" + table + "\", { \n";
          fields.forEach(function(field, i){
            text[table] += spaces + spaces + "\"" + field + "\"" + ": {\n";
            // add associations
            if (table in associations) {
              associations[table].forEach(function(association, indx) {
                if (association.from === field) {
                  text[table] += spaces + spaces + spaces + "\"references\": \"" + association.table + "\",\n"
                  text[table] += spaces + spaces + spaces + "\"referencesKey\": \"" + association.to + "\""
                  if ("on_update" in association) {
                    text[table] += ",\n" + spaces + spaces + spaces + "\"onUpdate\": \"" + association.on_update.toLowerCase() + "\""
                  }
                  if ("on_delete" in association) {
                    text[table] += ",\n" + spaces + spaces + spaces + "\"onDelete\": \"" + association.on_delete.toLowerCase() + "\""
                  }
                  text[table] += ",\n";
                }
              });
            }
            var fieldAttr = Object.keys(_tables[table][field]);
            // Serial key for postgres...
            var defaultVal = _tables[table][field].defaultValue;
            if (Sequelize.Utils._.isString(defaultVal) && defaultVal.toLowerCase().indexOf("nextval") !== -1 && defaultVal.toLowerCase().indexOf("regclass") !== -1) {
              text[table] += spaces + spaces + spaces + "\"type\": DataTypes.INTEGER,\n";
              text[table] += spaces + spaces + spaces + "\"primaryKey\": true\n";
            } else {
              // ENUMs for postgres...
              if (_tables[table][field].type === "USER-DEFINED" && !!_tables[table][field].special) {
                _tables[table][field].type = "ENUM(" + _tables[table][field].special.map(function(f){ return "\"" + f + "\""; }).join(",") + ")";
              }

              fieldAttr.forEach(function(attr, x){
                // We don't need the special attribute from postgresql describe table or allowNull true.
                if (attr === "special" || (attr === "allowNull" && _tables[table][field][attr])) {
                  return true;
                }
                else if (attr === "allowNull" && !_tables[table][field][attr]) {
                  text[table] += spaces + spaces + spaces + "\"" + attr + "\": " + _tables[table][field][attr];
                }
                else if (attr === "defaultValue") {
                  var val_text = defaultVal;
                  if (Sequelize.Utils._.isString(defaultVal)) {
                    val_text = "\"" + val_text + "\""
                  }
                  if(defaultVal === null) {
                    return true;
                  } else {
                    text[table] += spaces + spaces + spaces + "\"" + attr + "\": " + "\"" + val_text + "\"";
                  }
                }
                else if (attr === "primaryKey") {

                }
                else if (attr === "type" && _tables[table][field][attr].indexOf("ENUM") === 0) { text[table] += spaces + spaces + spaces + "\"" + attr + "\": DataTypes." + _tables[table][field][attr]; } else if (attr === "type") {
                  var _attr = _tables[table][field][attr].toLowerCase()
                  , val = "\"" + _tables[table][field][attr] + "\"";

                  if (_attr === "tinyint(1)" || _attr === "boolean") {
                    val = "DataTypes.BOOLEAN";
                  }
                  else if (_attr.match(/^(smallint|mediumint|tinyint|int)/)) {
                    var length = _attr.match(/\(\d+\)/);
                    val = "DataTypes.INTEGER" + (!!length ? length : "");
                  }
                  else if (_attr.match(/^bigint/)) {
                    val = "DataTypes.BIGINT";
                  }
                  else if (_attr.match(/^string|varchar|varying/)) {
                    val = "DataTypes.STRING";
                  }
                  else if (_attr.match(/text$/)) {
                    val = "DataTypes.TEXT";
                  }
                  else if (_attr.match(/^(date|time)/)) {
                    val = "DataTypes.DATE";
                  }
                  else if (_attr.match(/^(float|decimal|array)/)) {
                    val = "DataTypes." + _attr.toUpperCase();
                  }

                  text[table] += spaces + spaces + spaces + "\"" + attr + "\": " + val;
                }

                if ((x+1) < fieldAttr.length && (fieldAttr[x+1] !== "special" && !(fieldAttr[x+1] === "allowNull" && _tables[table][field][attr]))) {
                  text[table] += ",";
                }
                text[table] += "\n";
              });
            }

            text[table] += spaces + spaces + "}";
            if ((i+1) < fields.length) {
              text[table] += ",";
            }
            text[table] += "\n";
          });

          // set other options
          if (fields.indexOf("createdAt") === -1 && fields.indexOf("updatedAt") === -1) {
            // set timestamps to false
            text[table] += spaces + "},{\n";
            text[table] += spaces + spaces + "\"timestamps\": false"
          }
          text[table] += "\n" + spaces + "});\n};\n";
          _callback(null);
        }, function(){
          self.write(text, callback);
        });
      });
    });
  }

  AutoSequelize.prototype.write = function(attributes, callback) {
    var tables = Object.keys(attributes)
      , self = this;

    async.series([
      function(_callback){
        fs.lstat(self.options.directory, function(err, stat){
          if (err || !stat.isDirectory()) {
            fs.mkdir(self.options.directory, _callback);
          } else {
            _callback(null);
          }
        })
      }
    ], function(err){
      if (err) return callback(err);

      async.each(tables, function(table, _callback){
        fs.writeFile(self.options.directory + "/" + table + ".js", attributes[table], function(err){
          if (err) return _callback(err);
          _callback(null);
        });
      }, function(err){
        callback(err, null);
      });
    });
  }

  return AutoSequelize;
})();
