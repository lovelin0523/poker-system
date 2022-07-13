const Message = require('../entity/Message')
const RoomService = require('../service/RoomService')
const roomUtil = require('./roomUtil')
//分数梯队
const SCORE_CHELON = [2, 3, 5]
//吃喜
const HAPPY_SCORES = {
    REDALL: 5,
    FOUR: 5,
    PASS: 5
}
//推送异常消息
const sendErrorMsg = (connection, message, needRefresh) => {
    const msg = new Message(
        -1,
        connection.room,
        connection.user,
        {
            needRefresh: needRefresh
        },
        message
    )
    connection.send(JSON.stringify(msg))
}

module.exports = {
    //接收消息
    receiveMessage(result, connection, server) {
        let res = JSON.parse(result)
        if (typeof res != 'object' || !res) {
            sendErrorMsg(connection, '参数异常', true)
            return
        }
        //心跳检测消息
        if (res.type == 0) {
            const msg = new Message(0, res.room, res.user, {}, '心跳检测回执')
            connection.send(JSON.stringify(msg))
        }
        //有人加入房间
        else if (res.type == 1) {
            connection.room = res.room
            connection.user = res.user
            //获取该房间的所有连接
            const roomConnections = server.connections.filter(item => {
                return item.room == res.room
            })
            const users = roomConnections.map(item => {
                return item.user
            })
            let roomInfo = roomUtil.getRoom(res.room)
            //如果该房间在对局中，则需要初始化此用户的一些信息
            if (roomInfo && roomInfo.room_status == 1) {
                //获取records
                let records = roomInfo.getRoomRecords()
                //更新records
                records = roomUtil.updateRecordsByUsers(users, records)
                //重新设置records
                roomInfo.setRoomRecords(records)
                //更新room
                roomUtil.updateRoom(res.room, roomInfo)
            }
            roomConnections.forEach(conn => {
                if (conn === connection) {
                    const msg = new Message(
                        1,
                        conn.room,
                        conn.user,
                        {
                            users: users,
                            pokers: roomInfo?.getRoomRecords()?.pokers,
                            status: roomInfo?.getRoomRecords()?.status,
                            currentGame:
                                roomInfo?.getRoomRecords()?.currentGame,
                            scores: roomInfo?.getRoomRecords()?.scores,
                            isSelf: true
                        },
                        `你已加入房间`
                    )
                    conn.send(JSON.stringify(msg))
                } else {
                    //查找是否同时多个在线
                    if (conn.user.user_id === connection.user.user_id) {
                        sendErrorMsg(
                            conn,
                            '你在另一个地方登录，当前主机被迫下线',
                            true
                        )
                    } else {
                        const msg = new Message(
                            1,
                            conn.room,
                            conn.user,
                            {
                                users: users,
                                pokers: roomInfo?.getRoomRecords()?.pokers,
                                status: roomInfo?.getRoomRecords()?.status,
                                currentGame:
                                    roomInfo?.getRoomRecords()?.currentGame,
                                scores: roomInfo?.getRoomRecords()?.scores,
                                isSelf: false
                            },
                            `${res.user.user_nickname}加入房间`
                        )
                        conn.send(JSON.stringify(msg))
                    }
                }
            })
        }
        //游戏开始
        else if (res.type == 3) {
            //获取该房间的所有连接
            const roomConnections = server.connections.filter(item => {
                return item.room == res.room
            })
            RoomService.query(res.room)
                .then(roomInfo => {
                    //转为Room对象
                    roomInfo = roomUtil.initRoomObject(roomInfo)
                    if (roomInfo.room_creator != res.user.user_id) {
                        sendErrorMsg(connection, '非房主不能开始游戏', false)
                        return
                    }
                    //获取用户数组
                    const users = roomConnections.map(item => {
                        return item.user
                    })
                    //更改房间状态
                    roomInfo.room_status = 1
                    //获取records
                    let records = roomInfo.getRoomRecords()
                    //记录当前局数
                    records.currentGame = 1
                    //初始化每个用户的积分和状态、以及单局赢的次数
                    records = roomUtil.updateRecordsByUsers(users, records)
                    //重新设置records
                    roomInfo.setRoomRecords(records)
                    //记录
                    roomUtil.updateRoom(res.room, roomInfo)
                    //发牌
                    roomUtil.licensing(res.room, users)
                    //重新获取
                    roomInfo = roomUtil.getRoom(res.room)
                    //推送
                    roomConnections.forEach(conn => {
                        const msg = new Message(
                            3,
                            conn.room,
                            conn.user,
                            {
                                users: users,
                                pokers: roomInfo.getRoomRecords().pokers,
                                status: roomInfo.getRoomRecords().status,
                                currentGame:
                                    roomInfo.getRoomRecords().currentGame,
                                scores: roomInfo.getRoomRecords().scores
                            },
                            '游戏开始，推送数据'
                        )
                        conn.send(JSON.stringify(msg))
                    })
                })
                .catch(error => {
                    sendErrorMsg(connection, error.message, true)
                })
        }
        //配牌完成
        else if (res.type == 4) {
            let roomInfo = roomUtil.getRoom(res.room)
            //获取该房间的所有连接
            const roomConnections = server.connections.filter(item => {
                return item.room == res.room
            })
            //获取用户数组
            const users = roomConnections.map(item => {
                return item.user
            })
            //配牌不符合规矩
            if (!roomUtil.judgePokers(res.pokers[res.user.user_id])) {
                const msg = new Message(
                    5,
                    res.room,
                    res.user,
                    {
                        users: users,
                        pokers: roomInfo?.getRoomRecords()?.pokers,
                        status: roomInfo?.getRoomRecords()?.status,
                        currentGame: roomInfo?.getRoomRecords()?.currentGame,
                        scores: roomInfo?.getRoomRecords()?.scores
                    },
                    '配牌不符合大小顺序'
                )
                connection.send(JSON.stringify(msg))
                return
            }
            //获取records
            let records = roomInfo.getRoomRecords()
            //更新用户的状态
            let status = records.status
            status[res.user.user_id] = 1
            records.status = status
            //更新pokers
            records.pokers = res.pokers
            //设置roomRecords
            roomInfo.setRoomRecords(records)
            //记录
            roomUtil.updateRoom(res.room, roomInfo)
            //判断是否全部配牌完成
            let hasAllComplete = true
            for (let key in res.pokers) {
                if (status[key] == 0) {
                    hasAllComplete = false
                    break
                }
            }
            //推送配牌完成
            roomConnections.forEach(conn => {
                const msg = new Message(
                    4,
                    conn.room,
                    conn.user,
                    {
                        users: users,
                        pokers: roomInfo.getRoomRecords().pokers,
                        status: roomInfo.getRoomRecords().status,
                        currentGame: roomInfo.getRoomRecords().currentGame,
                        scores: roomInfo.getRoomRecords().scores,
                        isSelf: conn === connection,
                        hasAllComplete: hasAllComplete
                    },
                    `${res.user.user_nickname}已配牌完成`
                )
                conn.send(JSON.stringify(msg))
            })
        }
        //比试
        else if (res.type == 6) {
            let roomInfo = roomUtil.getRoom(res.room)
            //获取records
            let records = roomInfo.getRoomRecords()
            //获取pokers
            let pokers = records.pokers
            //获取scores
            let scores = records.scores
            //获取passData
            let passData = records.passData
            //获取该房间的所有连接
            const roomConnections = server.connections.filter(item => {
                return item.room == res.room
            })
            //获取用户数组
            const users = roomConnections.map(item => {
                return item.user
            })
            //获取对应组的用户pokers
            let obj = {}
            for (let key in pokers) {
                obj[key] = pokers[key].filter(item => {
                    return item.belong[0] == res.group
                })
            }
            //获取排序后的pokers数组
            const pokersArray = roomUtil.pokersSort(Object.values(obj))
            //临时分
            let tempScores = {}
            let userTotal = Object.values(obj).length
            //计算得失分
            for (let key in obj) {
                //判断每个用户的pokers数组中的位置
                const index = pokersArray.findIndex(item => {
                    return roomUtil.isSame(item, obj[key])
                })
                //2人
                if (userTotal == 2) {
                    //最大
                    if (index == 0) {
                        passData[key]++
                        tempScores[key] = SCORE_CHELON[0]
                    }
                    //最小
                    else {
                        tempScores[key] = -SCORE_CHELON[0]
                    }
                }
                //3人
                else if (userTotal == 3) {
                    //最大
                    if (index == 0) {
                        passData[key]++
                        tempScores[key] = SCORE_CHELON[0] + SCORE_CHELON[1]
                    }
                    //第二大
                    else if (index == 1) {
                        tempScores[key] = -SCORE_CHELON[0]
                    }
                    //最小
                    else {
                        tempScores[key] = -SCORE_CHELON[1]
                    }
                }
                //4人
                else if (userTotal == 4) {
                    //最大
                    if (index == 0) {
                        passData[key]++
                        tempScores[key] =
                            SCORE_CHELON[0] + SCORE_CHELON[1] + SCORE_CHELON[2]
                    }
                    //第二大
                    else if (index == 1) {
                        tempScores[key] = -SCORE_CHELON[0]
                    }
                    //第三大
                    else if (index == 2) {
                        tempScores[key] = -SCORE_CHELON[1]
                    }
                    //最小
                    else {
                        tempScores[key] -= -SCORE_CHELON[2]
                    }
                }
                scores[key] += tempScores[key]
            }
            //更新分数
            records.scores = scores
            //更新passData
            records.passData = passData
            //更新roomInfo
            roomInfo.setRoomRecords(records)
            //更新缓存的roomInfo
            roomUtil.updateRoom(res.room, roomInfo)
            //推送比试完成
            roomConnections.forEach(conn => {
                const msg = new Message(
                    6,
                    conn.room,
                    conn.user,
                    {
                        users: users,
                        pokers: roomInfo.getRoomRecords().pokers,
                        status: roomInfo.getRoomRecords().status,
                        currentGame: roomInfo.getRoomRecords().currentGame,
                        scores: roomInfo.getRoomRecords().scores,
                        tempScores: tempScores,
                        group: res.group
                    },
                    `第${res.group + 1}组比试完成`
                )
                conn.send(JSON.stringify(msg))
            })
        }
        //下一局
        else if (res.type == 7) {
            let roomInfo = roomUtil.getRoom(res.room)
            //获取该房间的所有连接
            const roomConnections = server.connections.filter(item => {
                return item.room == res.room
            })
            //获取用户数组
            const users = roomConnections.map(item => {
                return item.user
            })
            //获取records
            let records = roomInfo.getRoomRecords()
            //获取pokers
            let pokers = records.pokers
            //获取scores
            let scores = records.scores
            //获取passData
            let passData = records.passData
            //遍历pokers执行吃喜加分减分逻辑
            for (let key in pokers) {
                //其余用户的ID数组
                const otherUsers = Object.keys(pokers).filter(item => {
                    return item != key
                })
                //有全红全黑进行加分
                if (roomUtil.judgeRedAll(pokers[key])) {
                    scores[key] += HAPPY_SCORES.REDALL
                    //其余用户减分
                    otherUsers.forEach(item => {
                        scores[item] -= HAPPY_SCORES.REDALL
                    })
                }
                //有4个头加分
                const count = roomUtil.judegeFour(pokers[key])
                if (count > 0) {
                    scores[key] += HAPPY_SCORES.FOUR * count
                    //其余用户减分
                    otherUsers.forEach(item => {
                        scores[item] -= HAPPY_SCORES.FOUR * count
                    })
                }
                //通关加分
                if (passData[key] == 3) {
                    scores[key] += HAPPY_SCORES.PASS
                    //其余用户减分
                    otherUsers.forEach(item => {
                        scores[item] -= HAPPY_SCORES.PASS
                    })
                }
            }
            //判断是否结束，结束已经交给前端判断了，这边直接return
            if (records.currentGame == roomInfo.room_mode) {
                return
            }
            //记录当前局数
            records.currentGame = records.currentGame + 1
            //初始化每个用户的status和passData
            let status = {}
            passData = {}
            users.forEach(user => {
                status[user.user_id] = 0
                passData[user.user_id] = 0
            })
            records.status = status
            records.passData = passData
            //设置roomRecords
            roomInfo.setRoomRecords(records)
            //记录
            roomUtil.updateRoom(res.room, roomInfo)
            //发牌
            roomUtil.licensing(res.room, users)
            //获取房间
            roomInfo = roomUtil.getRoom(res.room)
            //推送
            roomConnections.forEach(conn => {
                const msg = new Message(
                    7,
                    conn.room,
                    conn.user,
                    {
                        users: users,
                        pokers: roomInfo.getRoomRecords().pokers,
                        status: roomInfo.getRoomRecords().status,
                        currentGame: roomInfo.getRoomRecords().currentGame,
                        scores: roomInfo.getRoomRecords().scores
                    },
                    `第${roomInfo.getRoomRecords().currentGame}局开始`
                )
                conn.send(JSON.stringify(msg))
            })
        }
        //结束
        else if (res.type == 8) {
            let roomInfo = roomUtil.getRoom(res.room)
            //记录结束时间
            roomInfo.room_end = Date.now()
            //更新房间状态为已完成
            roomInfo.room_status = 2
            //更新房间到数据库
            RoomService.update(roomInfo)
                .then(() => {
                    //获取该房间的所有连接
                    const roomConnections = server.connections.filter(item => {
                        return item.room == res.room
                    })
                    //获取用户数组
                    const users = roomConnections.map(item => {
                        return item.user
                    })
                    //推送
                    roomConnections.forEach(conn => {
                        const msg = new Message(
                            8,
                            conn.room,
                            conn.user,
                            {
                                users: users,
                                scores: roomInfo.getRoomRecords().scores
                            },
                            '本房间游戏结束'
                        )
                        conn.send(JSON.stringify(msg))
                    })
                    //推送完成后删除缓存的房间
                    roomUtil.removeRoom(res.room)
                })
                .catch(error => {
                    console.log(error)
                })
        }
    },
    //出现异常
    error(code, connection, server) {
        connection.close()
    },
    //连接关闭
    close(code, connection, server) {
        //获取该房间的所有连接
        const roomConnections = server.connections.filter(item => {
            return item.room == connection.room
        })
        //连接数不为0
        if (roomConnections.length) {
            const users = roomConnections.map(item => {
                return item.user
            })
            const roomInfo = roomUtil.getRoom(connection.room)
            roomConnections.forEach(conn => {
                if (conn != connection) {
                    const msg = new Message(
                        2,
                        conn.room,
                        conn.user,
                        {
                            users: users,
                            pokers: roomInfo?.getRoomRecords()?.pokers,
                            status: roomInfo?.getRoomRecords()?.status,
                            currentGame:
                                roomInfo?.getRoomRecords()?.currentGame,
                            scores: roomInfo?.getRoomRecords()?.scores
                        },
                        `${connection.user.user_nickname}离开了聊天室`
                    )
                    conn.send(JSON.stringify(msg))
                }
            })
        }
    }
}
