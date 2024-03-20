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

  return null;
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

console.log(`Store: ${config.uuid}.myshopify.com`);
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
            logWithTimestamp(`Uploading ${filepath}`);
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
    mesaJsonPath = `${dir}/mesa.json`;
    logWithTimestamp(": Uploading " + mesaJsonPath);
    upload(mesaJsonPath);

    break;

  case 'watch-custom-code':
    var watch = require('watch');
    program.force = 1;
    let timestamp = (new Date()).toLocaleDateString() + " " + (new Date()).toLocaleTimeString();
    console.log(`${timestamp}: Watching ${dir}`);

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

    let parts = dir.split('mesa-templates');
    let utilsDir = parts[0] + 'workflows/template-utils';

    console.log(`${timestamp}: Watching ${utilsDir}`);
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
          console.log(`Copying ${filepath} to ${destination}`);
          fs.copyFile(filepath, destination, () => {
            // Copy done - this callback function is required
          });
        }
      });

    break;

  case 'sync':
    let filepath = dir + "/mesa.json";

    automationKeyForSync = getAutomationKeyFromWorkingDirectory();

    // This makes it so that it's as if the export command was called with the automation key passed in
    files = [automationKeyForSync];
    console.log("Checking to see if mesa.json file exists: " + filepath);
    if (!fs.existsSync(filepath)) {
      console.log("Initial Workflow Export - run sync again when this is done");
      runExport(files);
      break;
    }    

    program.force = 1;
    var watch = require('watch');
    watch.watchTree(
      dir,
      {
        filter: function(filename) {
          // Exclude node_modules, only look for .js and .md files
          return filename.indexOf(/node_modules|.git/) === -1;
        }
      },
      function(filepath, curr, prev) {
        // Ignore the initial index of all files
        if (typeof filepath === 'object') {
          return;
        }
        console.log(filepath);
        if (filepath.indexOf('.js')) {
          upload(filepath);
        }
      }
    );
    
    watchRemote(dir)

    setInterval(function() {      
      watchRemote(dir)
    }, 3000);
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
            console.log(JSON.stringify(JSON.parse(item.fields.meta), null, 2));
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
  automationKeys = (files.length == 0) ? [getAutomationKeyFromWorkingDirectory()] : files;

  automationKeys.forEach(function(automation) {
    // Get mesa.json
    // {{url}}/admin/{{uuid}}/automations/{{automation_key}}.json
    request('GET', `automations/${automation}.json`, {}, function(
      response,
      data
    ) {
      if (response.config) {
        let mesaJsonString = JSON.stringify(response, null, 4);
        mesaJsonString = preprocessMesaJsonForExport(mesaJsonString)
        fs.writeFileSync('mesa.json',mesaJsonString);

        // Download and save scripts
        download('all', automation);
      }
    });
  });
}

function logWithTimestamp(message) {
  let timestamp = (new Date()).toLocaleDateString() + " " + (new Date()).toLocaleTimeString();
  console.log(timestamp + ": " + message);
}

function preprocessMesaJsonForExport(mesaJsonString) {
  let directoryParts = dir.split('/');
  if (directoryParts.includes('mesa-templates')) {
    let mesaJson = JSON.parse(mesaJsonString);
    mesaJson.key = getAutomationKeyFromWorkingDirectoryWithSlashes();

    if (mesaJson.config.storage) {
      delete mesaJson.config.storage;
    }  

    mesaJsonString = JSON.stringify(mesaJson, null, 4);
  }

  return mesaJsonString;
}

  // Turns /mesa-templates/etsy/product/pull_inventory_from_shopify into etsy_product_pull_inventory_from_shopify
function getAutomationKeyFromWorkingDirectory() {
  let parts = process.cwd().split('/');
  let automationKey = null;

  if (parts.includes('mesa-templates')) {
    parts = parts.slice(parts.indexOf('mesa-templates') + 1);
    automationKey = parts.join('_');
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

function getAutomationKeyFromWorkingDirectoryWithSlashes() {
  let parts = dir.split('/');
  let automationKey = null;
  
  if (parts.includes('mesa-templates')) {
    parts = parts.slice(parts.indexOf('mesa-templates') + 1);
    automationKey = parts.join('/');
  } else {
    console.log('ERROR'); 
    exit;
  }

  program.verbose ? console.log("getAutomationKeyFromWorkingDirectoryWithSlashes() dir: " + dir) : null;
  program.verbose ? console.log("getAutomationKeyFromWorkingDirectoryWithSlashes() key: " + automationKey) : null;
  return automationKey;
}

function watchRemote(dir) {
  let filepath = dir + "/mesa.json";  
  let localMirrorPath = filepath + ".remote";
  let automationKey = getAutomationKey(filepath);

  request('GET', `automations/${automationKey}.json`, {}, function(
    response,
    data
  ) {
    if (response.config) {
      const remoteContents = JSON.stringify(response, null, 4);
      if (!fs.existsSync(localMirrorPath)) {
        // console.log("Writing local mirror mesa json: " + localMirrorPath);
        fs.writeFileSync(localMirrorPath, remoteContents);
        return;
      } else {
        // console.log("Remote mirror json exists: " + localMirrorPath);
        let localMirrorContents = fs.readFileSync(localMirrorPath, 'utf8');
        if (remoteContents == localMirrorContents) {
          // console.log("Remote json is the same as local mirror");
        } else {
          console.log("Remote automation JSON changed - writing to: " + filepath);
          fs.writeFileSync(filepath, remoteContents);
          fs.writeFileSync(localMirrorPath, remoteContents);
        }
      }
    }
  });
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
    const automation = getAutomationKey(filepath);

    request('POST', `${automation}/scripts.json`, {
      script: {
        filename: filename,
        code: contents
      }
    });
  } else if (filename.indexOf('mesa.json') !== -1) {
    contents = JSON.parse(contents);
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

        console.log(`Saving ${filename} from automation ${automation}`);
        fs.writeFileSync(filename, item.code);
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
    console.log(`Creating directory: ${dir}...`);
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
