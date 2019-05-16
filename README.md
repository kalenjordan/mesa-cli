# mesa-cli

Command-line interface to download, watch and publish Mesa Scripts

## Configuring sites

Uses https://www.npmjs.com/package/config-yml

Example config.yml file:
```yaml
uuid: mystoreuuid
key: J0lSB0PIuw145xhk610Ud6dLA7A****B7LnfUjaL
```
Optional parameter: `api_url`.

## Usage

Initialize a new project and create a new `mesa.json` file:
```
mesa initialize -e ge-ff \
    --inputs=in-cbyge-orders,in-cbyge-ftp \
    --outputs=out-cbyge-orders-ftp,out-cbyge-orders-vo,out-cbyge-create-fulfillment \
    --secrets=ftp-password \
    --storage=discounts.json,skus.json \
    --directory=cbyge \
    --files=in-fulfillments.js,out-create-fulfillment.js,out-orders-ftp.js,out-virtual-output.js
```

Then use the utility functions to keep your local code in sync with Mesa:
```
mesa watch
mesa push <...files>
mesa pull <...files>
```

## Specifying environments

1. Save configuration files in `./config`. For example: `./config/mystoreuuid.yml`
2. Pass the environment with the `--env` or `-e` flags, or by setting the `ENV` envvar:
```
mesa watch --env mystoreuuid
mesa watch -e mystoreuuid
ENV=mystoreuuid mesa watch
export ENV=mystoreuuid && mesa watch
```
[Full details on usage](https://www.npmjs.com/package/config-yml)

## Local development

https://medium.com/netscape/a-guide-to-create-a-nodejs-command-line-package-c2166ad0452e

## @todos
- Handle dependencies
- Handle recursively uploading dirs
- Hide source code for all files in vendor/