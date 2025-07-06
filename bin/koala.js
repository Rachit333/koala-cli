#!/usr/bin/env node

const { Command } = require('commander');
const { runApp } = require('../lib/run');

const program = new Command();

program
  .name('koala')
  .description('Koala CLI – Deploy and run apps locally')
  .version('0.1.0');

program
  .command('run')
  .argument('<template>', 'project type (e.g. next-app)')
  .argument('<name>', 'app name')
  .action((template, name) => {
    runApp(template, name);
  });

program.parse();
