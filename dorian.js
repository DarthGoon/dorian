var fs = require('fs');
var cmbx = require('./lib/combinatorics').Combinatorics;
var mocha_module = require('mocha');
var expect = require('chai').expect;
var istanbul = require('istanbul');
var istanbul_core = require('./lib/istanbul-core');
istanbul_core.hookLoader('/Users/adayalan/Engineering/opal', {
    postLoadHook: function (matcherFn, transformer, verbose) {
        return function(file) {
            if (matcherFn(file)) {
                console.log("Instrumenting: %s", file);
            }
        };
    }
});
var mocha = new mocha_module({
    ui: 'tdd',
    reporter: 'spec'
});
var test_pass_incrementor = 0;

/**
 * TODO: this started out for debugging.  But would probably
 * help to be able to target tests with params at runtime.
 **/
var function_blacklist = [ 'doNotTestFunc', 'send_email_to_team', 'fraudCheck' ];
var function_whitelist = [];


/**
 * TODO: this feels weird, you can name a callback anything.
 * Should figure out how to detect the param as a function.
 */
var callback_whitelist = ['callback', 'next', 'cb'];



var third_party_modules = [];
var internal_modules = [];
var primitives = 0;
var arg_test_values = [ {}, [], 0, 1 ];
var fn_slicer = /(?:function\s\w+\(|function\s\()([^\)]+)\)/;
var fn_name_slicer = /(?:function\s)(\w+)/;
var multi_pass_generator = [];

function callback_fn(done) {
    return function () {
        var assertion;
        if (arguments) {
            for (var idx = 0; idx < arguments.length; idx++) {
                assertion = expect(typeof arguments[idx]).to.not.eq('error');
                assertion && arguments[idx] && walkTheTree(arguments[idx]);
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

function testFn(exported_object) {
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
                    var test_wired_args,
                        assertion;
                    if (hasCallback) {
                        test_wired_args = fill_callback_fn({
                            matrix: fn_args,
                            callback_arg_position: callback_arg_position
                        }, done)
                    }

                    assertion = expect(exported_object.apply(this, test_wired_args)).to.not.throw;

                    if (assertion && !hasCallback) {
                        walkTheTree(exported_object.apply(this, test_wired_args));
                        done();
                    }
                }));
            });
        } else {
            mocha.suite.addTest(new mochaTest(fn_declaration[0] + ' - handles - ' + JSON.stringify(fn_args), function (done) {
                var test_wired_args = [],
                    assertion;
                if (hasCallback) {
                    test_wired_args = [callback_fn(done)];
                }

                assertion = expect(exported_object.apply(this, test_wired_args)).to.not.throw;

                if (assertion && !hasCallback) {
                    walkTheTree(exported_object.apply(this, test_wired_args));
                    done();
                }
            }));
        }
    }
}

function walkTheTree(exported_object){
    multi_pass_generator.push(function() {
        switch (typeof exported_object) {
            case 'function':
                testFn(exported_object);
                break;
            case 'object':
                for (var prop in exported_object) {
                    if (exported_object.hasOwnProperty(prop)) {
                        var module_prop = exported_object[prop];
                        module_prop && walkTheTree(module_prop);
                    }
                }
                break;
            case 'string':
            case 'number':
            case 'boolean':
            default:
                break;
        }
    });
}

function buildTestSuite() {
    var floor = multi_pass_generator.length;
    if (test_pass_incrementor == 0 || multi_pass_generator.length < 100){
        floor = 0;
    } else {
        floor = multi_pass_generator.length - 100;
    }
    console.log('Building new test suite');
    while (multi_pass_generator.length > floor) {
        multi_pass_generator.pop()();
    }
}

function seeWhatBreaks() {
    var collector = new istanbul.Collector(),
        Report = istanbul.Report;

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
        walkTheTree(exported_object);
    });

    buildTestSuite();

    incrementalMochaRun(collector, function (failures) {
        var report = Report.create('html');
        report.writeReport(collector, true, function () {
            console.log('Generated report');
        });

        console.log('Tests ran: %s', mocha.suite.tests.length);
        console.log('Failures: %s', failures || 0);
        console.log('Dorian run successful');
    });
}

function incrementalMochaRun(collector, callback) {
    setTimeout(function () {
        var mocha_instance = mocha,
            coverage = global.__coverage__ = global.__coverage__ || {};
        mocha = new mocha_module({
            ui: 'tdd',
            reporter: 'spec'
        });

        test_pass_incrementor++;
        console.log('Tests generated for pass (%s): %s', test_pass_incrementor, mocha_instance.suite.tests.length);
        console.log('Starting Mocha test run...');

        mocha_instance.run(function (failures) {
            collector.add(coverage);
            buildTestSuite();
            if (mocha.suite.tests.length > 0) {
                incrementalMochaRun(collector, callback);
            } else {
                callback(failures);
            }
        });
    }, 1000);
}

module.exports = {
    run: seeWhatBreaks
};
