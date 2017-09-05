'use strict'
let async = require('async');

let commonJs = require('../../../CommonJS/common');
let variableManagerClass = require('./variableManager');
// let protoInstrumentClass = require('./protoInstrument');
let g_protoMgr = require('./protocolManager');
let pomeloClass = require('./pomeloClient');

const PROTO_TYPE = require('./protocolType');

class runningJob {
    constructor(jobObj, runningJobManager, consoleLogDepth, evn) {
        console.log('runningJob constructor: jobObj: %j', jobObj);
        this.jobObj = jobObj;
        this.runningJobId = -1;
        this.runningJobManager = runningJobManager;
        this.consoleLogDepth = consoleLogDepth;
        this.runningJobId = null;
        this.envirment = evn ? evn : {
            pomelo: null,
            variableManager: new variableManagerClass()
        };
        this.outputs = [];
    };

    setRunningJobId(id) {
        this.runningJobId = id;
    };

    getRunningJobId() {
        return this.runningJobId;
    };

    sendSessionLog(text) {
        let t = text;
        for (let i = 0; i < this.consoleLogDepth; ++i) {
            t = '\t-' + t;
        }
        let timestamp = Date.parse(new Date());
        // this.outputs += text + '\n';
        console.log("2" + t);
        this.outputs.push({text: t, timestamp: timestamp});
        this.outputs.push({text: "--", timestamp: timestamp});
        
        if (commonJs.isUndefinedOrNull(this.session) === false) {
            this.runningJobManager.log(this.runningJobId, t, timestamp); 
        }
        console.log("1" + t);


    };

    clearOutputs() {
        this.outputs = [];
    };

    getOutputs() {
        console.log("-->%j", this.outputs);
        return this.outputs;
    };

    runByStep(index, callback) {
        let ins = this.jobObj.getInstrument(index);
        if (ins) {
            this._runInstrument(ins, callback);
        } else {
            return callback(new Error('no instrument was found'));
        }
    };

    runAll(index, callback) {
        let self = this;
        this.clearOutputs();
        this.sendSessionLog('------------------------------->');
        this.sendSessionLog('start job' + this.jobObj.name);

        async.whilst(
            function breaker () {
                return index < self.jobObj.instruments.length;
            },
            function iterator (cb) {
                self.jobObj.instruments[index].runner = self;
                self._runInstrument(self.jobObj.instruments[index], index, function(err, data) {
                    if (err) {
                        switch(err) {
                            case 'jump':
                                if (data) {
                                    index = self.jobObj.tagList[data];
                                } else {
                                    index++;
                                }
                                return cb(null);
                            break;
                            case 'timer':
                                index++;
                                cb(null);
                            break;
                            default:
                                return cb(err);
                            break;
                        }
                    } else {
                        // 一共要执行的次数
                        let timer_count = self.envirment.variableManager.getVariableValue('timer_count');
                        // 定时协议从第几条开始
                        let timer_insIndex = self.envirment.variableManager.getVariableValue('timer_insIndex');
                        // 当前执行的次数索引
                        let countIndex = self.envirment.variableManager.getVariableValue('timer_countIndex');
                        // 定时时间间隔毫秒数
                        let milliSecond = self.envirment.variableManager.getVariableValue('timer_milliSecond');

                        // 已经执行到最后一条指令了
                        if (index >= self.jobObj.instruments.length-1 && countIndex && countIndex < timer_count) {
                            index = timer_insIndex;
                            setTimeout(function() {
                                self.envirment.variableManager.setVariableValue('timer_countIndex', countIndex + 1, 'int');
                                return cb(null);
                            }, milliSecond);
                        } else {
                            index++;
                            return cb(null);
                        }
                    }
                }); 
            },
            function(err){
                console.log(err);
                callback(err);
            }	
        );
    };

    _setTimerVariable(ins, index) {
        let msg = ins.getC2SMsg();
        let milliSecond = msg.milliSecond;
        let count = msg.count ? msg.count:99999;

        // 一共要执行的次数
        this.envirment.variableManager.createVariable('timer_count', count, 'int');
        // 定时协议从第几条开始
        this.envirment.variableManager.createVariable('timer_insIndex', index+1, 'int');
        // 定时时间间隔毫秒数
        this.envirment.variableManager.createVariable('timer_milliSecond', milliSecond, 'int');
        // 当前执行的次数索引
        this.envirment.variableManager.createVariable('timer_countIndex', 1, 'int');
    };

    _connectServer(ins, callback) {
        if (this.envirment.pomelo) {
            this.envirment.pomelo.removeAllListeners('io-error');
            this.envirment.pomelo.removeAllListeners('close');

            this.envirment.pomelo.disconnect();
            this.envirment.pomelo = null;
        }

        this.envirment.pomelo = new pomeloClass();

        let params = ins.getC2SMsg();
        this.envirment.pomelo.init({
            host: params['host'],
            port: params['port'],
            log: true
        }, (socketObj) => {
            if (commonJs.isUndefinedOrNull(socketObj)) {
                return callback(new Error('pomelo init failed!'));
            }

            this.envirment.pomelo.on('io-error', () => {
                return callback(new Error('io-error'));
            });
            this.envirment.pomelo.on('close', () => {
                return callback(new Error('network closed'));
            });
            return callback(null);
        });
    };

    _createVariable(ins, callback) {
        let c2sParams = ins.getParsedC2SParams();
        if (c2sParams.name.value) {
            let value = null;
            if (c2sParams.value.value !== null && c2sParams.value.value !== undefined && c2sParams.value.value !== '') {
                value = c2sParams.value.value;
            }
            this.envirment.variableManager.createVariable(c2sParams.name.value, value, c2sParams.value.type);
        }
        return callback(null);
    };
	
	// result: -1:error,0:false,1:true,2:ok
    _compareValue(ins) {
        let msg = ins.getC2SMsg();
        let p1 = msg.param1;
        let p2 = msg.param2;
        let tagName = msg.tagName;

        let result = -1;
        switch (ins.route) {
            case 'gotoGreater':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 > p2);
                }
            break;
            case 'gotoEqual':
                if ((typeof p1 === 'number' && typeof p2 === 'number') ||
                    (typeof p1 === 'string' && typeof p2 === 'string')) {
                    result = Number(p1 === p2);
                }
                break;
            case 'gotoLess':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 < p2);
                }
                break;
            case 'gotoGreaterOrEqual':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 >= p2);
                }
            break;
            case 'gotoLessOrEqual':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 <= p2);
                }
                break;
            case 'gotoNotEqual':
                if ((typeof p1 === 'number' && typeof p2 === 'number') ||
                    (typeof p1 === 'string' && typeof p2 === 'string')) {
                    result = Number(p1 !== p2);
                }
                break;
            case 'gotoNull':
                result = 2;
                break;
            default:
                break;
        }
        return {
            result:result,
            tagName:tagName
        };
    };

    _runInstrument(ins, index, callback) {
        switch (ins.type) {
            case PROTO_TYPE.SYSTEM:

                switch (ins.route) {
                    case 'connect':
                        this._connectServer(ins, callback);
                    break;
                    case 'createIntVariable':
                    case 'createStringVariable':
                        this._createVariable(ins, callback);
                    break;
					case 'gotoGreater':
                    case 'gotoEqual':
                    case 'gotoLess':
                    case 'gotoGreaterOrEqual':
                    case 'gotoLessOrEqual':
                    case 'gotoNotEqual':
                    case 'gotoNull':
                        let compareResult = this._compareValue(ins);
                        if (compareResult.result === 1 || compareResult.result === 2) {
                            callback('jump', compareResult.tagName);
                        } else {
                            callback(new Error('check goto cmd error !'));
                        }
                        break;
                    case 'tagItem':
                        callback(null);
                        break;
                    case 'timer':
                        this._setTimerVariable(ins, index);
                        callback('timer');
                        break;
                }
                break;
            case PROTO_TYPE.REQUEST:

                this.sendSessionLog("send: " + ins.route);
                this.sendSessionLog("timestampe: " + new Date().getTime());
                this.sendSessionLog("with params: " + JSON.stringify(ins.getC2SMsg()));
                this.envirment.pomelo.request(ins.route, ins.getC2SMsg(), (data) => {
                    // TODO: 这里要移到真正整个任务做完的地方
                    // this.envirment.pomelo.removeAllListeners('io-error');
                    // this.envirment.pomelo.removeAllListeners('close');

                    ins.onS2CMsg(data, callback);
                    // return callback(null);
                });
                break;
            case PROTO_TYPE.JOB:
                let jobId = ins.route;
                g_protoMgr.loadJobById(jobId, (err, job) => {
                    if (err) {
                        return callback(err);
                    }
                    let runningJobObj = new runningJob(job, this.session, this.consoleLogDepth + 1, this.envirment);

                    let firstIns = job.getInstrument(0);
                    let msg = ins.getC2SMsg();
                    for (let key in msg) {
                        if (msg[key]) {
                            firstIns.setC2SParamValue(key, msg[key]);
                        }
                    }


                    runningJobObj.runAll(0, callback);

                });
                break;
            case PROTO_TYPE.PUSH:
                this.sendSessionLog("listening to onPush message: " + ins.route);
                this.envirment.pomelo.removeAllListeners(ins.route);
                this.envirment.pomelo.on(ins.route, (data) => {
                    this.sendSessionLog("onPush: " + ins.route);
                    ins.onS2CMsg(data, (err)=>{});
                });
                callback(null);
                break;
            case PROTO_TYPE.NOTIFY:
                this.sendSessionLog("send notify: " + ins.route);
                this.sendSessionLog("with params: " + JSON.stringify(ins.getC2SMsg()));
                this.envirment.pomelo.notify(ins.route, ins.getC2SMsg());
                callback(null);
                break;
        }
    };

    stop(callback) {
        this.envirment.pomelo.removeAllListeners('io-error');
        this.envirment.pomelo.removeAllListeners('close');
                    
        this.envirment.pomelo.disconnect();
        this.envirment.pomelo = null;
        callback(null);
    };

    getName() {
        return this.jobObj.name;
    };

    getRunningJobId() {
        return this.runningJobId;
    };
};


module.exports = runningJob;