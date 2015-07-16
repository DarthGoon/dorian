var fs = require('fs');
var cmbx = require('./lib/combinatorics').Combinatorics;
var mocha_module = require('mocha');
var expect = require('chai').expect;
var istanbul = require('istanbul'),
    collector = new istanbul.Collector(),
    instrumentor = new istanbul.Instrumenter(),
    reporter = new istanbul.Reporter(),
    hook = istanbul.hook,
    myMatcher = function (file) { return !file.match(/dorian/); },
    myTransformer = function (code, file) {
        instrumentor.instrumentSync(code, file);
        return code;
    };
var mocha = new mocha_module({
    ui: 'tdd',
    reporter: 'spec'
});

hook.hookRequire(myMatcher, myTransformer);;
reporter.addAll([ 'text', 'lcov' ]);


/**
 * TODO: this started out for debugging.  But would probably
 * help to be able to target tests with params at runtime.
 **/
var function_blacklist = [ 'fraudCheck', 'dorianTestExecutor'];
var function_whitelist = [];


/**
 * TODO: this feels weird, you can name a callback anything.
 * Should figure out how to detect the param as a function.
 */
var callback_whitelist = ['callback', 'next', 'cb'];



var third_party_modules = [];
var internal_modules = [];
var arg_test_values = [ null, undefined, '', -1, 0 ];
var fn_slicer = /(?:function\s\w+\(|function\s\()([^\)]+)\)/;
var fn_name_slicer = /(?:function\s)(\w+)/;

function callback_fn(done) {
    return function () {
        if (arguments) {
            for (var idx = 0; idx < arguments.length; idx++) {
                expect(typeof arg).to.not.eq('error');
            }
        }
        console.log('test callback fired');
        done();
    };
}

function fill_callback_fn(options, done) {
    var matrix = options.matrix;
    matrix.splice(options.callback_arg_position, 0, callback_fn(done));
    return matrix;
}

function generateMatrix(fn_args){
    var callback_arg_position = -1;
    callback_whitelist.forEach(function(list_item){
        if (callback_arg_position == -1) {
            callback_arg_position = fn_args.indexOf(list_item);
        }
    });
    var args_count = callback_arg_position < 0 ? fn_args.length : fn_args.length - 1;
    var matrix = { values: args_count ? cmbx.baseN(arg_test_values, args_count).toArray() : [] };

    if (callback_arg_position != -1) {
        matrix.hasCallback = true;
        matrix.callback_arg_position = callback_arg_position;
        matrix.wireCallback = fill_callback_fn;
    }
    return matrix;
}

function testFn(exported_object, filename) {
    var mochaTest = mocha_module.Test;
    var fn_declaration = fn_slicer.exec(exported_object.toString());
    if (fn_declaration) {
        var fn_args = fn_declaration[1].replace(/\s/g, '').split(',');
        var fn_name = fn_name_slicer.exec(fn_declaration[0]);
        if (fn_name && function_blacklist.indexOf(fn_name[1]) != -1) {
            return;
        }
        var test_matrix = generateMatrix(fn_args);
        var hasCallback = test_matrix.hasCallback;
        var callback_arg_position = test_matrix.callback_arg_position;

        if (test_matrix.values.length > 0) {
            test_matrix.values.forEach(function (fn_args) {
                mocha.suite.addTest(new mochaTest(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                    var test_wired_args;
                    if (hasCallback) {
                        test_wired_args = fill_callback_fn({
                            matrix: fn_args,
                            callback_arg_position: callback_arg_position
                        }, done)
                    }
                    expect(exported_object.apply(this, test_wired_args)).to.not.throw;
                    if (!hasCallback) {
                        done();
                    }
                }));
            });
        } else {
            mocha.suite.addTest(new mochaTest(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                var test_wired_args = [];
                if (hasCallback) {
                    test_wired_args = [callback_fn(done)];
                }
                expect(exported_object.apply(this, test_wired_args)).to.not.throw;
                if (!hasCallback) {
                    done();
                }
            }));
        }
    }
}

function walkTheTree(exported_object, filename){
    switch (typeof exported_object){
        case 'function':
            testFn(exported_object, filename);
            break;
        case 'object':
            for(var prop in exported_object){
                if (exported_object.hasOwnProperty(prop)) {
                    var module_prop = exported_object[prop];
                    walkTheTree(module_prop);
                }
            }
            break;
        case 'string':
        case 'number':
        case 'boolean':
            console.log('Skipping exported primitive- %s:%s', typeof exported_object, exported_object);
            break;
        default:
            console.log('Unsupported module.exports type: %s', typeof exported_object);
            break;
    }
}

function seeWhatBreaks() {
    module.parent.children.forEach(function (module) {
        if (module.filename.indexOf('node_modules') != -1
        || module.filename.indexOf('dorian') != -1) {  //TODO: stupid hack while the module doesn't come from npm
            third_party_modules.push(module);
        } else {
            internal_modules.push(module);
        }
    });

    internal_modules.forEach(function (app_module) {
        var exported_object = app_module.exports;

        /*console.log(collector.files());

        var filecoverage = collector.fileCoverageFor(app_module.filename);
        var coverageObj = {};

        coverageObj[app_module] = filecoverage;
        collector.add(coverageObj);*/

        walkTheTree(exported_object, app_module.filename);
    });

    console.log('Tests generated: %s', mocha.suite.tests.length);
    console.log('Starting Mocha test run...');
    mocha.run(function (failures) {
        reporter.write(collector, true, function () {
            console.log('All reports generated');
        });
        console.log('Tests ran: %s', mocha.suite.tests.length);
        console.log('Failures: %s', failures || 0);
        console.log('Dorian ops successfully completed');
    });
}

module.exports = {
    run: seeWhatBreaks
};
