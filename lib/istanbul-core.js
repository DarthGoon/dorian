/*
 Copyright (c) 2013, Yahoo! Inc.  All rights reserved.
 Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
var istanbul = require('istanbul'),
    hook = istanbul.hook,
    Report = istanbul.Report,
    Instrumenter = istanbul.Instrumenter,
    instrumenter = null,
    baselineCoverage = {};

//returns a matcher that returns all JS files under root
//except when the file is anywhere under `node_modules`
//does not use istanbul.matcherFor() so as to expose
//a synchronous interface
function getRootMatcher(root) {
    return function (file) {
        if (file.indexOf(root) !== 0) { return false; }
        file = file.substring(root.length);
        if (file.indexOf('node_modules') >= 0) { return false; }
        return true;
    };
}

/**
 * save the baseline coverage stats for a file. This baseline is not 0
 * because of mainline code that is covered as part of loading the module
 * @method saveBaseline
 * @param file the file for which baseline stats need to be tracked.
 * @private
 */
function saveBaseline(file) {
    var coverageObject = global.__coverage__ || {},
        fileCoverage;
    if (coverageObject && coverageObject[file]) {
        fileCoverage = coverageObject[file];
        if (!baselineCoverage[file]) {
            baselineCoverage[file] = {
                s: clone(fileCoverage.s),
                f: clone(fileCoverage.f),
                b: clone(fileCoverage.b)
            };
        }
    }
}

//deep-copy object
function clone(obj) {
    if (!obj) { return obj; }
    return JSON.parse(JSON.stringify(obj));
}
/**
 * hooks `require` to add instrumentation to matching files loaded on the server
 * @method hookLoader
 * @param {Function|String} matcherOrRoot one of:
 *      a match function with signature `fn(file)` that returns true if `file` needs to be instrumented
 *      a root path under which all JS files except those under `node_modules` are instrumented
 * @param {Object} opts instrumenter options
 */
function hookLoader(matcherOrRoot, opts) {
    /*jslint nomen: true */
    var matcherFn,
        transformer,
        postLoadHook,
        postLoadHookFn;

    opts = opts || {};
    opts.coverageVariable = '__coverage__'; //force this always

    postLoadHook = opts.postLoadHook;
    if (!(postLoadHook && typeof postLoadHook === 'function')) {
        postLoadHook = function (/* matcher, transformer, verbose */) { return function (/* file */) {}; };
    }
    delete opts.postLoadHook;

    if (typeof matcherOrRoot === 'function') {
        matcherFn = matcherOrRoot;
    } else if (typeof matcherOrRoot === 'string') {
        matcherFn = getRootMatcher(matcherOrRoot);
    } else {
        throw new Error('Argument was not a function or string');
    }

    if (instrumenter) { return; } //already hooked
    instrumenter = new Instrumenter(opts);
    transformer = instrumenter.instrumentSync.bind(instrumenter);
    postLoadHookFn = postLoadHook(matcherFn, transformer, opts.verbose);

    hook.hookRequire(matcherFn, transformer, {
        verbose: opts.verbose,
        postLoadHook: function (file) {
            postLoadHookFn(file);
            saveBaseline(file);
        }
    });
}

module.exports = {
    hookLoader: hookLoader
};