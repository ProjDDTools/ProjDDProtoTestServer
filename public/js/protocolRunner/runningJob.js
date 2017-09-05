'use strict'
let async = require('async');
let schedule = require('node-schedule');

let commonJs = require('../../../CommonJS/common');
let variableManagerClass = require('./variableManager');
// let protoInstrumentClass = require('./protoInstrument');
let g_protoMgr = require('./protocolManager');
let pomeloClass = require('./pomeloClient');

const PROTO_TYPE = require('./protocolType');

class runningJob {
    constructor(jobObj, runningJobManager, consoleLogDepth, evn) {
        // console.log('runningJob constructor: jobObj: %j', jobObj);
        this.jobObj = jobObj;
        this.runningJobId = -1;
        this.runningJobManager = runningJobManager;
        this.consoleLogDepth = consoleLogDepth;
        this.runningJobId = null;
        this.envirment = evn ? evn : {
            pomelo: null,
            variableManager: new variableManagerClass(),
            rootRunningJob: this 
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
        this.envirment.rootRunningJob._sendSessionLog(this.consoleLogDepth, text);
    };

    _sendSessionLog(depth, text) {
        let t = text;
        for (let i = 0; i < depth; ++i) {
            t = '\t' + t;
        }
        let timestamp = Date.parse(new Date());
        this.outputs.push({text: t, timestamp: timestamp});
        this.runningJobManager.log(this.runningJobId, t, timestamp);         
    }

    clearOutputs() {
        this.outputs = [];
    };

    getOutputs() {
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

    runAll(instruments, callback) {
        this.clearOutputs();
        this.sendSessionLog('------------------------------->');
        this.sendSessionLog('start job' + this.jobObj.name);
        let index = 0;
        async.eachSeries(instruments, (item, cb) => {
                item.runner = this;
                this._runInstrument(item, index++, cb);
            },
            (err) => {
                this.sendSessionLog('<-------------------------');
                if (err == 'jump') {
                    //return callback(null);
                    this.runAll(this.newInsArray, callback);
                } else {
                    callback(err);
                }
            });
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
            if (value !== null) {
               this.envirment.variableManager.createVariable(c2sParams.name.value, value, c2sParams.value.type);
            }
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
            case 'gg':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 > p2);
                }
            break;
            case 'ge':
                if ((typeof p1 === 'number' && typeof p2 === 'number') ||
                    (typeof p1 === 'string' && typeof p2 === 'string')) {
                    result = Number(p1 === p2);
                }
                break;
            case 'gl':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 < p2);
                }
                break;
            case 'gge':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 >= p2);
                }
            break;
            case 'gle':
                if (typeof p1 === 'number' && typeof p2 === 'number') {
                    result = Number(p1 <= p2);
                }
                break;
            case 'gne':
                if ((typeof p1 === 'number' && typeof p2 === 'number') ||
                    (typeof p1 === 'string' && typeof p2 === 'string')) {
                    result = Number(p1 !== p2);
                }
                break;
            case 'gnull':
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

    _getInstrumentsByIndex(index) {
        let newInsArray = [];
        for (let i = 0; i < this.jobObj.instruments.length; i++) {
            if (i >= index) {
                newInsArray.push(this.jobObj.instruments[i]);
            }
        }
        return newInsArray;
    };

    _executeCurrentTagContent(tagName, callback) {
        // 从头搜索此标签的位置
        let index = -1;
        for (let i = 0; i < this.jobObj.instruments.length; i++) {
            if (this.jobObj.instruments[i].type == 4 && this.jobObj.instruments[i].route == 'tagItem') {
                let msg = this.jobObj.instruments[i].getC2SMsg();
                if (msg.name == tagName) {
                    index = i;
                    break;
                }
            }
        }
        // 罗列后面的指令集
        this.newInsArray = this._getInstrumentsByIndex(index);
        callback('jump');
    };

    _runTimerInstrument(data) {
        console.log('1>>>>>>>>> data.name = ' + data.name);
        let name = data.name;
        let self = data.self;
        let instruments = data.instruments;

        self.runAll(instruments, function(err) {
            console.log('2>>>>>>>>> err = ' + err);
            self.sendSessionLog("run timer protocol error: " + err);
        });
    };

    _onTimer(ins, index, callback) {
        let self = this;
        let msg = ins.getC2SMsg();
        let second = msg.second ? msg.second:'1-60';
        let minute = msg.minute ? msg.minute:'*';
        let hour = msg.hour ? msg.hour:'*';
        let day = msg.day ? msg.day:'*';
        let month = msg.month ? msg.month:'*';
        let week = msg.week ? msg.week:'*';

        // 定时格式
        let cronTimer = second + ' ' + minute + ' ' + hour + ' ' + day + ' ' + month + ' ' + week;

        // 罗列后面的指令集
        let newInsArray = this._getInstrumentsByIndex(index + 1);
        
        schedule.scheduleJob(cronTimer, self._runTimerInstrument, {
            name: 'timer',
            self: self,
            instruments: newInsArray
        });
        callback(null);
    };

    _runInstrument(ins, index, callback) {
        let self = this;

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
					case 'gg':
                    case 'ge':
                    case 'gl':
                    case 'gge':
                    case 'gle':
                    case 'gne':
                    case 'gnull':
                        let compareResult = this._compareValue(ins);
                        if (compareResult.result === 1) {
                            // 条件判定成立，走标签流程
                            this._executeCurrentTagContent(compareResult.tagName, callback);
                        } else if (compareResult.result === 2) {
                            // 无条件，继续执行
                            if (compareResult.tagName === null || compareResult.tagName === undefined || compareResult.tagName === '') {
                                // 没有定义标签，则继续走
                                callback(null);
                            } else {
                                // 有标签，走标签流程
                                this._executeCurrentTagContent(compareResult.tagName, callback);
                            }
                        } else {
                            // 发生错误,终止执行JOB
                            callback(new Error('发生错误, result = %j', compareResult.result));
                        }
                        break;
                    case 'tagItem':
                        callback(null);
                        break;
                    case 'timer':
                        this._onTimer(ins, index, callback)
                        break;
                }
                break;
            case PROTO_TYPE.REQUEST:

                this.sendSessionLog("send: " + ins.route);
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
                    let runningJobObj = new runningJob(job, this.runningJobManager, this.consoleLogDepth + 1, this.envirment);

                    let firstIns = job.getInstrument(0);
                    let msg = ins.getC2SMsg();
                    for (let key in msg) {
                        if (msg[key]) {
                            firstIns.setC2SParamValue(key, msg[key]);
                        }
                    }


                    runningJobObj.runAll(runningJobObj.jobObj.instruments, callback);

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
    }

    getName() {
        return this.jobObj.name;
    }

    getRunningJobId() {
        return this.runningJobId;
    }
};


module.exports = runningJob;