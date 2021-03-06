'use strict'
let async = require('async');

let commonJs = require('../../../CommonJS/common');
let runningJobClass = require('./runningJob');
let g_jobServerMgr = require('./jobServerManager');


class runningJobManager{
    constructor() {
        this.sessionMap = {};           // uid -> session
        this.runningJobMap = {};        // uid -> job map( runningJobId -> runningJobObject)
        this.runningJobSubscribeMap = {};  // runningJobId --> uid map(uid -> color)

        this.maxRunningJobId = 0;
    };

    registerSession(uid, sessionObj) {
        this.sessionMap[uid] = sessionObj;
    }

    // unRegisterSession(uid) {
    //     delete this.sessionMap[uid];
    //     // for (let jobId in this.runningJobSubscribeMap) {
    //     //     let sessions = this.runningJobSubscribeMap[jobId];
    //     //     let idx = sessions.indexOf(sessionId);
    //     //     if (idx >= 0) {
    //     //         sessions.splice(idx, 1);
    //     //     }
    //     // }
    // }

    createRunningJob(jobObj, uid) {
        let runningJobObj = new runningJobClass(jobObj, this, 0, null);
        let runningJobId = this.maxRunningJobId;
        this.maxRunningJobId++;

        runningJobObj.setRunningJobId(runningJobId);
        this.runningJobMap[uid][runningJobId] = runningJobObj;

        return runningJobId;
    }

    runJob(uid, jobObj, gameUserIdList, cb) {
        let session = this.sessionMap[uid];
        if (commonJs.isUndefinedOrNull(session)) {
            return -1;
        }
        if (commonJs.isUndefinedOrNull(this.runningJobMap[uid])) {
            this.runningJobMap[uid] = {};
        }

        // let runningJobObj = new runningJobClass(jobObj, this, 0, null);
        // let runningJobId = this.maxRunningJobId;
        // this.maxRunningJobId++;

        // runningJobObj.setRunningJobId(runningJobId);
        // this.runningJobMap[uid][runningJobId] = runningJobObj;
        
        // 老方法（单服处理）
        // runningJobObj.runAll(0, (err) => {
        //     return cb(err, runningJobId);
        // });

        // 新方法（交给job子服处理）
        // g_jobServerMgr.runJob(uid, jobObj, runningJobId, gameUserId, (err) => {
        //     return cb(err, runningJobId);
        // });

        g_jobServerMgr.runJob(uid, jobObj, gameUserIdList, (err, curRunningJobIdList) => {
            return cb(err, curRunningJobIdList);
        });
    }

    stopJob(uid, runningJobId) {
        let runningJobs = this.runningJobMap[uid]
        if (commonJs.isUndefinedOrNull(runningJobs)) {
            return false;
        }

        if (runningJobId < 0 || runningJobId >= runningJobs.length) {
            return false;
        }

        let runningJob = runningJobs[runningJobId];
        runningJob.stop((err)=>{});
        delete runningJobs[runningJobId];
        
        return true;
    }

    getAllRunningJobs(uid) {
        let runningJobsMap = this.runningJobMap;

        if (commonJs.isUndefinedOrNull(runningJobsMap)) {
            return {};
        }

        let ret = {};
        for (let key in runningJobsMap) {
            if (commonJs.isUndefinedOrNull(ret[key])) {
                ret[key] = [];
            }

            for (let runningJobId in runningJobsMap[key]) {
                let runningJobObject = runningJobsMap[key][runningJobId];
                
                let obj = {name:runningJobObject.getName(), runningJobId: runningJobId, isSubscribed: false, color: '000000'};
                
                if (commonJs.isUndefinedOrNull(this.runningJobSubscribeMap[runningJobId]) === false) {
                    let subscribedInfo = this.runningJobSubscribeMap[runningJobId][uid];
                    if (commonJs.isUndefinedOrNull(subscribedInfo) === false) {
                        obj.isSubscribed = true;
                        obj.color = subscribedInfo.color;
                    }
                }

                ret[key].push(obj);
            }

        }

        return ret;
    }

    // 参数color可以省略，用于控制前端显示的颜色用的，省略的话用默认颜色
    subscribeToJobConsole(uid, jobId, color) {
        if (commonJs.isUndefinedOrNull(this.runningJobSubscribeMap[jobId])) {
            this.runningJobSubscribeMap[jobId] = {};
        }

        let jobSubscribeMap = this.runningJobSubscribeMap[jobId];
        if (commonJs.isUndefinedOrNull(jobSubscribeMap[uid])) {

            jobSubscribeMap[uid] = {uid: uid, color: color};

            // subscribe之后要把之前所有log都发送过去
            let jobObj = this.runningJobMap[uid][jobId];
            let sessionObj = this.sessionMap[uid];

            if (commonJs.isUndefinedOrNull(jobObj) || commonJs.isUndefinedOrNull(sessionObj)) {
                return;
            }

            let historyOutputs = jobObj.getOutputs();
            for (let i in historyOutputs) {
                sessionObj.Console(historyOutputs[i].text, jobId, color, historyOutputs[i].timestamp);
            }
        }
        else {
            let jobObj = this.runningJobMap[uid][jobId];
            let sessionObj = this.sessionMap[uid];
            let historyOutputs = jobObj.getOutputs();

            for (let i in historyOutputs) {
                sessionObj.Console(historyOutputs[i].text, jobId, jobSubscribeMap[uid].color, historyOutputs[i].timestamp);
            }
        }

        // 通知给job服
        g_jobServerMgr.subscribeToJobConsole(uid, jobId, color);
    }

    unSubscribeToJobConsole(uid, jobId) {
        if (commonJs.isUndefinedOrNull(this.runningJobSubscribeMap[jobId]) || commonJs.isUndefinedOrNull(this.runningJobSubscribeMap[jobId][uid])) {
            return;
        }
        delete this.runningJobSubscribeMap[jobId][uid];

        // 通知给job服
        g_jobServerMgr.unSubscribeToJobConsole(uid, jobId);
    }

    setSubscribedConsoleColor(uid, jobId, color) {
        if (commonJs.isUndefinedOrNull(this.runningJobSubscribeMap[jobId]) || commonJs.isUndefinedOrNull(this.runningJobSubscribeMap[jobId][uid])) {
            return;
        }
        this.runningJobSubscribeMap[jobId][uid].color = color;

        // 通知给job服
        //g_jobServerMgr.setSubscribedConsoleColor(uid, jobId, color);
    }

    log(runningJobId, text, timestamp) {
        let jobSubscribeMap = this.runningJobSubscribeMap[runningJobId];
        if (commonJs.isUndefinedOrNull(jobSubscribeMap)) {
            return;
        }

        for (let uid in jobSubscribeMap) {
            let session = this.sessionMap[jobSubscribeMap[uid].uid];
            if (commonJs.isUndefinedOrNull(session) === false && session.isActive() === true) {
                session.Console(text, runningJobId, jobSubscribeMap[uid].color, timestamp);
            }
        }
    }

    runProtocol(connInfo, protocolList, cb) {
        g_jobServerMgr.runProtocol(connInfo, protocolList, cb);
    }
};


module.exports = new runningJobManager();

