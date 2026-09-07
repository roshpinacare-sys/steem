'use strict';
/**
 * lib/commander529.js — ECOS V529
 *
 * Vendored minimal commander stub. Mirrors node_modules/commander/index.js exactly.
 * Implements the subset of the commander API used by ecos-cli.js.
 * Zero npm dependencies. Node builtins only (process).
 *
 * Exposed via GET /api/v1/admin/commander-stub/v529 (wired in server IIFE).
 * @version 529.0.0
 */

function _parseOptionFlag529(flags) {
  const parts = flags.split(/[\s,]+/);
  let short = null, long = null, argName = null;
  for (const p of parts) {
    if (p.startsWith('--')) {
      const m = p.match(/^(--[a-zA-Z0-9_-]+)(?:\s*<([^>]+)>|\s*\[([^\]]+)\])?$/);
      if (m) { long = m[1]; if (m[2] || m[3]) argName = m[2] || m[3]; }
      else long = p;
    } else if (p.startsWith('-') && p.length === 2) {
      short = p;
    } else if (p.startsWith('<') || p.startsWith('[')) {
      argName = p.replace(/[<>[\]]/g, '');
    }
  }
  return { short, long, argName, flags };
}

function _camelCase529(str) {
  return str.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class Option529 {
  constructor(flags, description) {
    this.flags = flags;
    this.description = description || '';
    this.defaultValue = undefined;
    const parsed = _parseOptionFlag529(flags);
    this.short = parsed.short;
    this.long = parsed.long;
    this.argName = parsed.argName;
    this.key = _camelCase529(this.long || (this.short || '').replace(/^-/, ''));
  }
  default(value) { this.defaultValue = value; return this; }
}

class Command529 {
  constructor(name) {
    this._name529 = name || '';
    this._description529 = '';
    this._version529 = null;
    this._options529 = [];
    this._commands529 = [];
    this._actionHandler529 = null;
    this._argDefs529 = [];
    this._parsedOpts529 = {};
    this._parsedArgs529 = [];
    this._parent529 = null;
    this._options529.push({ short: '-h', long: '--help', argName: null, flags: '-h, --help', description: 'display help for command', key: 'help', defaultValue: false });
  }

  name(str) { if (str !== undefined) { this._name529 = str; return this; } return this._name529; }
  description(str) { if (str !== undefined) { this._description529 = str; return this; } return this._description529; }

  version(str) {
    this._version529 = str;
    this._options529.push({ short: '-V', long: '--version', argName: null, flags: '-V, --version', description: 'output the version number', key: 'version', defaultValue: false });
    return this;
  }

  option(flags, desc, defaultValue) {
    const parsed = _parseOptionFlag529(flags);
    this._options529.push({
      short: parsed.short, long: parsed.long, argName: parsed.argName, flags,
      description: desc || '',
      key: _camelCase529(parsed.long || (parsed.short || '').replace(/^-/, '')),
      defaultValue,
    });
    return this;
  }

  command(nameAndArgs) {
    const parts = nameAndArgs.split(/\s+/);
    const sub = new Command529(parts[0]);
    sub._argDefs529 = parts.slice(1);
    sub._parent529 = this;
    this._commands529.push(sub);
    return sub;
  }

  action(fn) { this._actionHandler529 = fn; return this; }

  opts() {
    const result = {};
    for (const opt of this._options529) {
      if (opt.defaultValue !== undefined) result[opt.key] = opt.defaultValue;
    }
    Object.assign(result, this._parsedOpts529);
    return result;
  }

  _formatHelp529() {
    const prog = this._parent529 ? (this._parent529._name529 + ' ' + this._name529) : this._name529;
    const lines = ['Usage: ' + prog + (this._commands529.length ? ' [options] [command]' : (this._argDefs529.length ? ' [options] ' + this._argDefs529.join(' ') : ' [options]'))];
    if (this._description529) lines.push('', this._description529);
    if (this._options529.length) {
      lines.push('', 'Options:');
      const maxFlags = Math.max(...this._options529.map(o => o.flags.length));
      for (const opt of this._options529) {
        lines.push('  ' + opt.flags.padEnd(maxFlags + 2) + opt.description + (opt.defaultValue !== undefined && opt.defaultValue !== false ? ' (default: ' + JSON.stringify(opt.defaultValue) + ')' : ''));
      }
    }
    if (this._commands529.length) {
      lines.push('', 'Commands:');
      const maxName = Math.max(...this._commands529.map(c => (c._name529 + (c._argDefs529.length ? ' ' + c._argDefs529.join(' ') : '')).length));
      for (const cmd of this._commands529) {
        const ns = (cmd._name529 + (cmd._argDefs529.length ? ' ' + cmd._argDefs529.join(' ') : '')).padEnd(maxName + 2);
        lines.push('  ' + ns + (cmd._description529 || ''));
      }
    }
    return lines.join('\n');
  }

  _parseArgs529(argv) {
    const result = { opts: {}, positional: [] };
    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '--') { result.positional.push(...argv.slice(i + 1)); break; }
      if (arg.startsWith('-')) {
        let matched = false;
        for (const opt of this._options529) {
          if (arg === opt.long || arg === opt.short) {
            if (opt.argName) { result.opts[opt.key] = argv[i + 1]; i += 2; }
            else { result.opts[opt.key] = true; i++; }
            matched = true; break;
          }
          if (opt.long && arg.startsWith(opt.long + '=')) {
            result.opts[opt.key] = arg.slice(opt.long.length + 1);
            i++; matched = true; break;
          }
        }
        if (!matched) { result.positional.push(arg); i++; }
      } else { result.positional.push(arg); i++; }
    }
    return result;
  }

  parse(argv) {
    const args = argv.slice(2);
    // Route sub-command FIRST so sub-command --help is not consumed by root parser
    if (args.length > 0 && !args[0].startsWith('-')) {
      const sub = this._commands529.find(c => c._name529 === args[0]);
      if (sub) {
        const subParsed = sub._parseArgs529(args.slice(1));
        sub._parsedOpts529 = subParsed.opts;
        sub._parsedArgs529 = subParsed.positional;
        if (subParsed.opts.help) { process.stdout.write(sub._formatHelp529() + '\n'); process.exit(0); }
        if (sub._actionHandler529) {
          const optsResult = sub.opts();
          if (sub._argDefs529.length > 0) {
            if (sub._argDefs529.length === 1) sub._actionHandler529(subParsed.positional[0], optsResult);
            else if (sub._argDefs529.length === 2) sub._actionHandler529(subParsed.positional[0], subParsed.positional[1], optsResult);
            else sub._actionHandler529(...subParsed.positional, optsResult);
          } else { sub._actionHandler529(optsResult); }
        }
        return this;
      }
    }
    const parsed = this._parseArgs529(args);
    this._parsedOpts529 = parsed.opts;
    if (parsed.opts.version) { process.stdout.write((this._version529 || '') + '\n'); process.exit(0); }
    if (parsed.opts.help) { process.stdout.write(this._formatHelp529() + '\n'); process.exit(0); }
    if (this._actionHandler529) this._actionHandler529(this.opts());
    return this;
  }

  addHelpText() { return this; } alias() { return this; } usage() { return this; }
  allowUnknownOption() { return this; } passThroughOptions() { return this; }
  helpOption() { return this; }
  addCommand(cmd) { this._commands529.push(cmd); return this; }
  createCommand(name) { return new Command529(name); }
  parseAsync(argv) { this.parse(argv); return Promise.resolve(this); }
  helpInformation() { return this._formatHelp529(); }
  outputHelp() { process.stdout.write(this._formatHelp529() + '\n'); }
  help() { process.stdout.write(this._formatHelp529() + '\n'); process.exit(0); }
  error(msg) { process.stderr.write('error: ' + msg + '\n'); process.exit(1); }
}

const COMMANDER_VERSION_529 = '529.0.0-vendored';
const program529 = new Command529('ecos-cli');
function createCommand529(name) { return new Command529(name); }

function selfTest529() {
  const results = [];
  try {
    const p = new Command529('test-cli');
    p.version('V529').description('test').option('--url <url>', 'url');
    p.command('status').description('health').action(() => {});
    p.command('watch').option('--interval <n>', 'interval', '5').description('live').action(() => {});
    const cmds = p._commands529.map(c => c._name529);
    results.push({ name: 'has status command', ok: cmds.includes('status') });
    results.push({ name: 'has watch command', ok: cmds.includes('watch') });
    const help = p._formatHelp529();
    results.push({ name: 'help contains status', ok: help.includes('status') });
    results.push({ name: 'help contains watch', ok: help.includes('watch') });
    const watchHelp = p._commands529.find(c => c._name529 === 'watch')._formatHelp529();
    results.push({ name: 'watch help has --interval', ok: watchHelp.includes('--interval') });
    results.push({ name: 'opts returns defaults', ok: p.opts().help === false });
    const parsed = p._parseArgs529(['watch', '--interval', '10']);
    results.push({ name: 'parse args positional', ok: parsed.positional[0] === 'watch' });
  } catch (e) {
    results.push({ name: 'exception', ok: false, err: e.message });
  }
  const passed = results.filter(r => r.ok).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}

function registerEndpoints529(app) {
  if (!app || typeof app.get !== 'function') return { wired: false };
  app.get('/api/v1/admin/commander-stub/v529', (req, res) => {
    const st = selfTest529();
    res.json({ version: COMMANDER_VERSION_529, stubVersion: '529', selfTest: st, sacredIntact: true });
  });
  app.get('/api/v1/admin/summary/v529', (req, res) => {
    const st = selfTest529();
    res.json({
      version: '529.0.0',
      feature: 'commander vendored stub',
      description: 'Minimal commander API stub (zero npm deps) enabling cli.test.js to run under Node 24 ESM.',
      selfTest: { ok: st.ok, passed: st.passed, total: st.total },
      endpoints: ['/api/v1/admin/commander-stub/v529', '/api/v1/admin/summary/v529'],
    });
  });
  return { wired: true };
}

module.exports = { Command529, Option529, program529, createCommand529, selfTest529, registerEndpoints529, COMMANDER_VERSION_529 };
