#!/usr/bin/env node
const program = require('commander');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sh = require('shelljs');

let apiUrl = 'https://api.getmesa.com/v1/admin';

// Get the current dir
const dir = sh.pwd().stdout;

// Get arguments and options
function list(val) {
  return val.split(',');
}

program
  .version('2.0.6')
  .usage('[options] <file ...>')
  .option('-e, --env [value]', 'Environment to use (filename in `./config/`)')
  .option('-a, --automation [value]', 'Automation key')
  .option('-f, --force', 'Force')
  .option('-v, --verbose', 'Verbose')
  .option('-n, --number [value]', 'Number')
  .option('-p, --payload [value]', 'Payload')
  .parse(process.argv);

let [cmd, ...files] = program.args;

program.verbose ? console.log(`Working directory: ${dir}`) : null;

function loadEnv() {
  if (program.env) {
    return program.env;
  }

  let parts = dir.split('/');
  if (parts.includes('accounts')) {
    let accountName = parts[parts.indexOf('accounts') + 1];
    return accountName;
  }

  return 'default';
}

let env = loadEnv();

program.verbose ? console.log("Env: " + env) : null;

let config;
try {
  config = require('config-yml').load(env);
  program.verbose ? console.log("Loaded shop config from: Local config") : null;
} catch (e) {
  try {
    process.chdir(`${process.env.HOME}/.mesa`);
    config = require('config-yml').load(env);
    process.chdir(dir);
    program.verbose ? console.log("Loaded shop config from: Global config in ~/.mesa") : null;
  } catch (e) {
    console.log(e);
    const configFile = env ? env : 'config';
    return console.log(
      `Could not find an appropriate ${configFile}.yml file. Exiting.`
    );
  }
}
if (!config.uuid && cmd) {
  return console.log('UUID not specified in config.yml. Exiting.');
}

console.log(pad('Store:', 22) + config.uuid);
// const dir = process.env.INIT_CWD;
program.verbose ? console.log(`Verbose Output Enabled`) : null;
//console.log('');

// Read mesa.json
let mesa;
try {
  mesa = fs.readFileSync(`${dir}/mesa.json`, 'utf8');
  if (!mesa) {
    mesa = fs.readFileSync(`${dir}/mesa-collection.json`, 'utf8');
  }
  mesa = JSON.parse(mesa);
} catch (e) {
  //return console.log('Could not find mesa.json. Exiting.');
}

switch (cmd) {
  case 'push':
    files == [] ? ['mesa.json', 'mesa-collection.json'] : files;
    let mesa = null;

    // Currently we're just gonna force push all `push` cmds because the logic gets too difficult otherwise
    program.force = true;

    files.forEach(function(filename) {
      const filepath = `${dir}/${filename}`;
      if (filename.indexOf('mesa.json') !== -1) {
        mesa = filename;
      }
    });

    // If we're uploading mesa.json, we need to be a little smart about the order to set the scripts properly
    if (mesa) {
      upload(mesa, function(data) {
        files.forEach(function(filename) {
          const filepath = `${dir}/${filename}`;
          if (filename.indexOf('mesa.json') === -1) {
            logWithTimestamp(`Uploading ${filename}`);
            upload(filepath);
            sleep(500);
          }
        });
        // Make sure all of the script uploads have time to finish
        console.log('Sleeping for 5 seconds before setting mesa.json');
        setTimeout(function() {
          console.log('Setting mesa.json');
          upload(mesa);
        }, 5000);
      });
    }
    // Just upload the files
    else {
      files.forEach(function(filename) {
        const filepath = `${dir}/${filename}`;
        if (
          filename.indexOf('mesa.json') === -1 &&
          fs.lstatSync(filepath).isFile()
        ) {
          upload(filepath);
        }
      });
    }

    break;

  case 'push-mesa-json':
    program.force = true;
    console.log(pad('Workflow: ', 22) + getRemoteAutomationKeyFromLocalWorkingDirectory());
    mesaJsonPath = `${dir}/mesa.json`;
    logWithTimestamp("Uploading mesa.json");
    upload(mesaJsonPath);

    break;

  case 'watch-custom-code':
    var watch = require('watch');
    program.force = 1;
    let timestamp = (new Date()).toLocaleDateString() + " " + (new Date()).toLocaleTimeString();
    logWithTimestamp(`Watching ${dir}`);

    watch.watchTree(
      dir,
      {
        filter: function(filename) {
          return filename.indexOf(/node_modules|.git/) === -1;
        }
      },
      function(filepath, curr, prev) {
        // Ignore the initial index of all files
        if (typeof filepath === 'object') {
          return;
        }
        if (filepath.slice(-3) == '.js') {          
          logWithTimestamp(`Found file change: ${path.parse(filepath).base}`);
          upload(filepath);
        }
      }
    );

    let utilsDir = null;
    if (dir.includes('mesa-templates')) {
      let parts = dir.split('mesa-templates');
      utilsDir = parts[0] + 'template-utils/classes';  
    } else if (dir.includes('workflows')) {
      let parts = dir.split('workflows');
      utilsDir = parts[0] + 'template-utils/classes';  
    }

    logWithTimestamp(`Watching ${utilsDir}`);
    watch.watchTree(utilsDir, 
      {
        filter: function(filename) {
          return filename.indexOf(/node_modules|.git/) === -1;
        }
      },
      function(filepath, curr, prev) {
        // Ignore the initial index of all files
        if (typeof filepath === 'object') {
          return;
        }
        if (filepath.indexOf('.js')) {
          let filename = path.parse(filepath).base;
          let destination = dir + '/' + filename;
          logWithTimestamp(`Copying ${filename} to ${destination}`);
          fs.copyFile(filepath, destination, () => {
            // Copy done - this callback function is required
          });
        }
      });

      setTimeout(() => {
        logWithTimestamp(`Copy Util.js and ShopifyUtil.js after starting to watch`);
        let filepath = utilsDir + '/Util.js';
        let filename = path.parse(filepath).base;
        let destination = dir + '/' + filename;
        fs.copyFileSync(filepath, destination);
        
        filepath = utilsDir + '/ShopifyUtil.js';
        filename = path.parse(filepath).base;
        destination = dir + '/' + filename;
        fs.copyFileSync(filepath, destination);  
      }, 1000);
  
    break;
  
  case 'add-step':
    program.force = true;
    console.log(pad('Workflow: ', 22) + getRemoteAutomationKeyFromLocalWorkingDirectory());
    console.log(pad("Adding step:", 22) + files);  

    let stepName = files;
    let baseUrl = 'https://raw.githubusercontent.com/kalenjordan/mesa-template-utils/master/code-templates';
    let configUrl = baseUrl + `/${stepName}/step.json`;
    let codeUrl = baseUrl + `/${stepName}/code.js`;

    // Need the step config loaded in order for addStepCode to know the name of the key it needs to use for
    // the code contents. Then, need to upload the code first and in the upload callback, upload the mesa.json
    // because it requires the script to be uploaded first.
    fetch(configUrl).then(response => {
      return response.json();
    }).then(stepConfig => {
      fetch(codeUrl).then(response => {
        return response.text();
      }).then(codeContents => {
        addStepCode(stepName, stepConfig, codeContents, function(uploadResults) {
          addStepConfig(stepName, stepConfig);
        });
      });
    });

    break;

  case 'pull':
    download(files);
    break;

  case 'export':
    runExport(files);    
    break;

  case 'export-all':
    runExportAll(files);    
    break;
  
    case 'install':
    // In this instance, `files` is the template name
    if (files == []) {
      return console.log('ERROR', 'No template specified');
    }

    files.forEach(function(template) {
      const response = request(
        'POST',
        `templates/install.json`,
        {
          template: template,
          force: program.force ? 1 : 0
        },
        function(data) {
          console.log(`Installed ${template}. Log:`);
          console.log(data.log);
        }
      );
    });
    break;

  case 'replay':
    // In this instance, `files` is the task id
    if (files == []) {
      return console.log('ERROR', 'No Task ID specified');
    }

    files.forEach(function(taskId) {
      request('POST', `tasks/${taskId}/replay.json`);
    });
    break;

  case 'test':
    // In this instance, `files` is the task id
    if (!files[0]) {
      return console.log('ERROR', 'No automation key specified');
    }

    const automationKey = files[0];
    const triggerKey = files[1];
    const url = triggerKey ? `${automationKey}/triggers/${triggerKey}/test.json` : `automations/${automationKey}/test.json`;
    request(
      'POST',
      url,
      {
        payload: program.payload
      },
      function(data) {
        console.log(data);
        if (data.task.id) {
          console.log('Test successfully enqueued:');
          console.log(
            `https://${config.uuid}.myshopify.com/admin/apps/mesa/apps/mesa/admin/shopify/queue/task/${data.task.id}`
          );
          console.log('');
        }
      }
    );
    break;

  case 'logs':
    let params = program.payload ? JSON.parse(program.payload) : {};
    if (program.number) {
      params.limit = program.number;
    }
    const logsUrl = 'logs.json?' + Object.keys(params).map(key => key + '=' + params[key]).join('&');

    const response = request('GET', logsUrl, {}, function(data) {
      // Truncate the array if necessary
      if (program.number) {
        data.logs = data.logs.slice(
          Math.max(data.logs.length - parseInt(program.number))
        );
      }

      data.logs.forEach(item => {
        const date = new Date(item['@timestamp']);
        const dateString =
          date.toLocaleDateString('en-US') +
          ' ' +
          date.toLocaleTimeString('en-US');
        console.log(
          `[${dateString}] [${item.trigger.name}] [${item.trigger._id}] ${item.message}`
        );

        // Print details
        if (program.verbose && item.fields && item.fields.meta) {
          try {
            console.log(JSON.stringify(JSON.parse(item.fields.meta), null, 4));
          } catch (e) {
            console.log(item.fields.meta);
          }
        }
      });
    });
    break;

  default:
    console.log('mesa export <automation_key>');
    console.log('mesa push [params] <files>');
    console.log('mesa pull [params] <files>');
    console.log('mesa watch');
    console.log('mesa install <template> [version]');
    console.log('mesa test <automation_key> <input_output_key>');
    console.log('mesa replay <task_id>');
    console.log('mesa logs [-v] [-n 50]');
    console.log('');
    console.log('Optional Parameters:');
    console.log(
      '  -e, --env [value] : Environment to use (filename in `./config/`).'
    );
    console.log(
      '  -a, --automation [value] : Automation key. Automatically determined by the mesa.json file if not specified.'
    );
    console.log(
      '  -f, --force : Force, overwrite config for inputs/outputs/storage.'
    );
    console.log('  -n, --number [value] : Number.');
    console.log('  -v, --verbose : Verbose: Show log metadata.');
    console.log('');
}

function addStepConfig(stepName, stepConfig) {
  let filepath = `${dir}/mesa.json`;
  let workflowConfig = JSON.parse(fs.readFileSync(filepath, 'utf8'));

  workflowConfig.config.outputs.push(stepConfig);
  // console.log(workflowConfig.config.outputs);

  logWithTimestamp("Uploading mesa.json");
  fs.writeFileSync(filepath, JSON.stringify(workflowConfig, null, 4));
  upload(filepath);  
}

function addStepCode(stepName, stepConfig, code, callback) {
  // Load config and figure out what the key name is for stepConfig

  let filepath = `${dir}/${stepName}.js`;
  logWithTimestamp("Uploading " + filepath);
  fs.writeFileSync(filepath, code);
  upload(filepath, callback);  

  // console.log(pad("Adding code:", 22) + "Not implemented yet");
}

function runExportAll(files) {
  let parts = dir.split('/');
  if (! parts.includes('accounts')) {
    console.log('ERROR: not in an account directory');
    return;
  }

  if (! program.number) {
    console.log("Error: Pass in a max number (--number)");
    return;
  }

  let accountDir = dir;

  console.log('');
  request('GET', `automations.json`, {}, function(response, data) {
    let automations = response.automations.slice(0, program.number);
    console.log("Exporting " + automations.length + " workflows");

    for (let automation of automations) {
      let automationKey = automation.key;

      // It looks at the parent directory of the file so I have to pass in the mesa.json piece
      createDirectories(dir + '/' + automationKey + '/mesa.json');
      process.chdir(dir + '/' + automationKey);

      automationKey = getAutomationKeyFromWorkingDirectory();
      request('GET', `automations/${automationKey}.json`, {}, function(response, data) {
        let mesaJsonString = JSON.stringify(response, null, 4);
        mesaJsonString = preprocessMesaJsonForExport(mesaJsonString)

        process.chdir(dir + '/' + automationKey); 
        console.log(pad(automationKey, 80) + "Saving mesa.json \n");
        fs.writeFileSync('mesa.json',mesaJsonString);

        request('GET', `${automationKey}/scripts.json`, {}, function(response, data) {
          response.scripts.forEach(function(item) {
            process.chdir(accountDir + '/' + automationKey); 
            const filename = item.filename;
            console.log(pad(automationKey, 80) + "Saving " + filename);
            fs.writeFileSync(filename, item.code);
          });
          console.log('');
        });
      });  
    }
  });
}

function pad(str, width) {
  var len = Math.max(0, width - str.length);
  return str + Array(len + 1).join(' ');
}

function runExport(files) {  
  automationKey = (files.length == 0) ? getRemoteAutomationKeyFromLocalWorkingDirectory() : files.toString();
  console.log(pad('Workflow: ', 22) + automationKey);

  let localDirectory = getLocalDirectoryFromRemoteAutomationKey(automationKey);
  if (process.cwd() != localDirectory) {
    // It looks at the parent directory of the file so I have to pass in the mesa.json piece
    createDirectories(localDirectory + '/mesa.json');

    console.log(pad("Chdir:", 22) + localDirectory);
    process.chdir(localDirectory);
  }

  // Get mesa.json
  // {{url}}/admin/{{uuid}}/automations/{{automation_key}}.json
  request('GET', `automations/${automationKey}.json`, {}, function(
    response,
    data
  ) {
    if (response.config) {
      let mesaJsonString = JSON.stringify(response, null, 4);
      mesaJsonString = preprocessMesaJsonForExport(mesaJsonString)
      fs.writeFileSync('mesa.json',mesaJsonString);
      console.log(pad('Saved:', 22) + 'mesa.json');

      // Download and save scripts
      download('all', automationKey);
    }
  });
  
}

function logWithTimestamp(message) {
  let timestamp = (new Date()).toLocaleDateString() + " " + (new Date()).toLocaleTimeString();
  console.log(pad(timestamp + ": ", 22) + message);
}

function preprocessMesaJsonForExport(mesaJsonString) {
  let directoryParts = dir.split('/');
  if (directoryParts.includes('mesa-templates')) {
    let mesaJson = JSON.parse(mesaJsonString);
    mesaJson.key = remoteToLocalAutomationKey(mesaJson.key);

    if (mesaJson.config.storage) {
      delete mesaJson.config.storage;
    }  

    let templateConfig = getTemplateConfig(mesaJson.key);
    if (templateConfig && templateConfig.template_variables) {
      mesaJson = injectTemplateVariables(mesaJson, templateConfig.template_variables);
    }

    if (templateConfig && templateConfig.setup) {
      mesaJson.setup = templateConfig.setup;
    }

    if (mesaJson.config.inputs[0].metadata.next_sync_date_time) {
      console.log(pad("Deleting hard coded:", 22) + "next_sync_date_time");
      delete mesaJson.config.inputs[0].metadata.next_sync_date_time;
    }

    mesaJsonString = JSON.stringify(mesaJson, null, 4);
  }

  return mesaJsonString;
}

function getTemplateConfig(locationAutomationKey) {
  let filepath = process.cwd() + '/config.json';
  if (!fs.existsSync(filepath)) {
    return null;
  }

  let contents = fs.readFileSync(filepath, 'utf8');
  let config = JSON.parse(contents);

  return config;
}

function injectTemplateVariables(mesaObject, templateVariables) {
  for (let templateVariable of templateVariables) {
    let step = mesaObject.config.outputs.find(object => object.key == templateVariable.key);
    if (! step) {
      step = mesaObject.config.inputs.find(object => object.key == templateVariable.key);
    }
    if (! step) {
      console.error("Step not found: " + step);
      process.exit();
    }
    console.log(pad("Template variable:", 22) + " - " + templateVariable.key + "-" + templateVariable.field);    

    // Splits i.e. metadata.message into parts
    let parts = templateVariable.field.split('.'); 

    if (parts.length == 1) {
      step[parts[0]] = templateVariable.value;
    } else if (parts.length == 2) {
      step[parts[0]][parts[1]] = templateVariable.value;
    } else if (parts.length == 3) {
      step[parts[0]][parts[1]][parts[2]] = templateVariable.value;
    } else {
      console.log("injectTemplateVariables Error: didn't parse field: " + templateVariable.field);
      process.exit();
    }
  }

  return mesaObject;
}

// Turns /mesa-templates/etsy/product/pull_inventory_from_shopify into etsy_product_pull_inventory_from_shopify
function getRemoteAutomationKeyFromLocalWorkingDirectory() {
  let parts = process.cwd().split('/');
  let automationKey = null;

  if (parts.includes('mesa-templates')) {
    parts = parts.slice(parts.indexOf('mesa-templates') + 1);
    automationKey = parts.join('__');
  } else if (parts.includes('accounts')) {
    parts = parts.slice(parts.indexOf('accounts') + 2);
    automationKey = parts.join('_');
  } else {
    automationKey = parts[parts.length - 3] + "_" + parts[parts.length - 2] + "_" + parts[parts.length - 1];
  }

  program.verbose ? console.log("getAutomationKeyFromWorkingDirectory() dir: " + process.cwd()) : null;
  program.verbose ? console.log("getAutomationKeyFromWorkingDirectory() key: " + automationKey) : null;
  return automationKey;
}

/**
 *
 * @param {string} filepath
 */
function upload(filepath, cb) {
  if (!fs.lstatSync(filepath).isFile()) {
    return;
  }

  const filename = path.parse(filepath).base;
  const extension = path.extname(filename);
  let contents = fs.readFileSync(filepath, 'utf8');

  // @todo: do we want to allow uploading of .md files? if (extension === '.md' || extension === '.js') {
  if (extension === '.js') {    
    const automation = getRemoteAutomationKey(filepath);

    request('POST', `${automation}/scripts.json`, {
      script: {
        filename: filename,
        code: contents
      }
    }, function(data) {
      if (cb) {
        // console.log('Running callback');
        cb(data);
      }
    });
  } else if (filename.indexOf('mesa.json') !== -1) {
    contents = JSON.parse(contents);
    contents.key = getRemoteAutomationKey();
    
    try {
      const readme = fs.readFileSync(
        filepath.replace('mesa.json', 'README.md'),
        'utf8'
      );
      if (readme) {
        contents.readme = readme;
      }
    }
    catch(error) { }
    if (!contents.config) {
      return console.log(
        'Mesa.json did not contain any config elements. Skipping.'
      );
    }
    program.verbose ? console.log('Importing configuration from mesa.json...') : null;
    const force = program.force ? '?force=1' : '';
    
    program.verbose ? console.log('Force: ' + force) : null;
    
    request('POST', `automations.json${force}`, contents, function(data) {
      console.log('');
      if (data.log) {
        if (program.verbose) {
          console.log(`Log from mesa.json import of automation ${contents.key}:`);
          console.log(data.log);  
        }
      } else {
        console.log('There was a problem importing the mesa.json file:');
        console.log(data);
      }
      console.log('');
      if (cb) {
        console.log('Running callback');
        cb(data);
      }
    });
  }
  else if (filename.indexOf('mesa-collection.json') !== -1) {
    contents = JSON.parse(contents);
    if (!contents.templates) {
      return console.log(
        'Mesa-collection.json did not contain any templates. Skipping.'
      );
    }
    console.log('Sorry, mesa-collection.json files are currently not supported in the mesa-cli. Please import each template individually.');
  } else {
    console.log(`Skipping ${filename}`);
  }
}

/**
 * Templates keys (shopify/order/do_stuff) map to actual workflow keys (shopify__order__do_stuff)
 * Need to replace getAutomationKey() eventually
 */
function getRemoteAutomationKey(filepath) {
  if (program.automation) {
    return program.automation;
  }

  let mesa = fs.readFileSync(`${dir}/mesa.json`, 'utf8');

  if (!mesa) {
    return console.log('Could not find mesa.json file.');
  }

  mesa = JSON.parse(mesa);
  if (!mesa.key) {
    return console.log('Could not find key attribute in mesa.json file.');
  }

  let mesaKey = mesa.key;
  mesaKey = mesaKey.replace(/\//g, '__');

  return mesaKey;
}

/**
 * Templates keys (shopify/order/do_stuff) map to actual workflow keys (shopify__order__do_stuff)
 * Need to replace getAutomationKey() eventually
 */
function getLocalDirectoryFromRemoteAutomationKey(remoteAutomationKey) {
  let dirParts = process.cwd().split('/');
  if (dirParts.includes('mesa-templates')) {
    let keyParts = remoteAutomationKey.split('__');

    let baseDir = dirParts.slice(0, dirParts.indexOf('mesa-templates') + 1).join('/');
    let localDir = baseDir + '/' + keyParts.join('/');

    return localDir;
  }

  return process.cwd();
}

/**
 * Turns shopify__order__do_stuff) into shopify/order/do_stuff for templates
 */
function remoteToLocalAutomationKey(remoteAutomationKey) {
  return remoteAutomationKey.split('__').join('/');
}

function getAutomationKey(filepath) {
  if (program.automation) {
    return program.automation;
  }

  const dir = path.dirname(filepath);
  let mesa = fs.readFileSync(`${dir}/mesa.json`, 'utf8');

  if (!mesa) {
    return console.log('Could not find mesa.json file.');
  }

  mesa = JSON.parse(mesa);
  if (!mesa.key) {
    return console.log('Could not find key attribute in mesa.json file.');
  }

  return mesa.key;
}

/**
 * Download and save files via the Mesa Scripts API.
 *
 * @param {array} files
 */
function download(files, automation) {
  if (!automation) {
    automation = getAutomationKey(files[0]);
  }
  if (!automation) {
    return console.log('Could not find determine automation.');
  }

  request('GET', `${automation}/scripts.json`, {}, function(response, data) {
    response.scripts.forEach(function(item) {
      if (files === 'all' || files.indexOf(item.filename) !== -1) {
        // filename = !mesa || !mesa.directories || !mesa.directories.lib ?
        //   item.filename :
        //   item.filename.replace(`${mesa.directories.lib}/`, '');
        const filename = item.filename;

        createDirectories(filename);

        fs.writeFileSync(filename, item.code);
        console.log(pad('Saved:', 22) + filename);
      }
    });
  });
}

/**
 * Recursively create directories
 *
 * @param {string} filename
 */
function createDirectories(filename) {
  const dir = path.dirname(filename);
  if (dir && !fs.existsSync(dir)) {
    console.log(pad(`Creating directory:`, 22) + dir);
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Call the Mesa API.
 *
 * @param {string} method
 * @param {string} endpoint
 * @param {object} data
 * @param {function} cb
 */
function request(method, endpoint, data, cb) {
  // Let the api url be overwritten in config.yml
  apiUrl = config.api_url ? config.api_url : apiUrl;

  const options = {
    url: `${apiUrl}/${config.uuid}/${endpoint}`,
    method: method,
    headers: { 'x-api-key': config.key },
    json: true
  };
  if (method !== 'GET' && data) {
    options.data = data;
  }

  if (program.verbose) {
    console.log("Request options: ", options);
  }

  axios(options)
    .then(function(response) {
      if (cb) {
        cb(response.data);
      }
      // Commenting this out because watch-remote will output it every 3 seconds
      // console.log(`Success: ${options.method} ${options.url}`);
    })
    .catch(function(error) {
      //console.log(error.response.data);
      const msg =
        error.response && error.response.data ? error.response.data : error;
      // const msg = error.response && error.response.status ? `${error.response.status}: ${error.response.statusText}` : error;
      console.log('ERROR', options, msg);
    });
}

/**
 * Hacky sleep() method to avoid rate limit errors
 *
 * @param milliseconds
 */
function sleep(milliseconds) {
  var start = new Date().getTime();
  for (var i = 0; i < 1e7; i++) {
    if (new Date().getTime() - start > milliseconds) {
      break;
    }
  }
}
