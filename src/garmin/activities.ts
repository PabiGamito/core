// Strautomator Core: Garmin Activities

import {GarminActivity, GarminPingActivityFile} from "./types"
import {UserData} from "../users/types"
import api from "./api"
import database from "../database"
import _ from "lodash"
import logger from "anyhow"
import FitParser from "fit-file-parser"
import dayjs from "../dayjs"
import * as logHelper from "../loghelper"
const settings = require("setmeup").settings

/**
 * Garmin activities.
 */
export class GarminActivities {
    private constructor() {}
    private static _instance: GarminActivities
    static get Instance() {
        return this._instance || (this._instance = new this())
    }

    /**
     * Get, process and save device list from Garmin for the specified activity.
     * @param user User requesting the Garmin data.
     * @param ping The Garmin activity ping data.
     */
    processActivity = async (user: UserData, ping: GarminPingActivityFile): Promise<any> => {
        if (!ping || !ping.activityId || !ping.userId) {
            logger.error("Garmin.processActivity", logHelper.user(user), logHelper.garminActivity(ping), "Missing activityId or userId, won't process")
            return
        }

        // Base activity data to be saved to the database.
        const activity: GarminActivity = {
            id: ping.activityId,
            userId: user.id,
            profileId: ping.userId,
            name: ping.activityName,
            dateStart: dayjs.unix(ping.startTimeInSeconds).utc().toDate()
        }

        // Activity has a callback URL? Download and process the FIT file to extract the device IDs.
        try {
            if (ping.callbackURL) {
                const rawData = await this.getActivityFile(user, ping)
                if (rawData) {
                    await this.parseFitFile(user, activity, rawData)
                }
            }
        } catch (ex) {
            logger.error("Garmin.processActivity", logHelper.user(user), logHelper.garminActivity(ping), ex)
        } finally {
            await this.saveActivity(user, activity)
        }
    }

    // GET DATA FROM GARMIN
    // --------------------------------------------------------------------------

    /**
     * Get list of activities for the user.
     * @param user User requesting the Garmin data.
     * @param dateFrom From date.
     * @param dateTo Optional date to, defaults to dateFrom + 24 hours.
     */
    getActivities = async (user: UserData, dateFrom: dayjs.Dayjs, dateTo?: dayjs.Dayjs): Promise<void> => {
        try {
            if (!dateTo) {
                dateTo = dateFrom.add(86399, "seconds")
            }

            const tokens = user.garmin.tokens
            const query = `uploadStartTimeInSeconds=${dateFrom.utc().unix()}&uploadEndTimeInSeconds=${dateTo.utc().unix()}`
            const res = await api.makeRequest(tokens, `wellness-api/rest/activities?${query}`)

            return res
        } catch (ex) {
            logger.error("Garmin.getActivities", logHelper.user(user), ex)
            throw ex
        }
    }

    /**
     * Get the activity FIT file for the specified activity. Returns the raw activity data.
     * @param user User requesting the Garmin data.
     * @param ping The Garmin activity ping data.
     */
    getActivityFile = async (user: UserData, ping: GarminPingActivityFile): Promise<any> => {
        try {
            if (!ping || !ping.callbackURL) {
                throw new Error("Missing activity callbackURL")
            }

            // Try fetching the FIT file specified in the callback URL.
            const tokens = user.garmin.tokens
            const res = await api.makeRequest(tokens, ping.callbackURL, "GET", true)
            if (res) {
                return Buffer.from(res)
            }

            // Failed to download FIT file.
            logger.warn("Garmin.getActivityFile", logHelper.user(user), logHelper.garminActivity(ping), "Failed to download raw data")
            return null
        } catch (ex) {
            logger.error("Garmin.getActivityFile", logHelper.user(user), logHelper.garminActivity(ping), ex)
            throw ex
        }
    }

    // INTERNAL
    // --------------------------------------------------------------------------

    /**
     * Parse FIT file and append extra data to the activity.
     * @param user The user.
     * @param activity The Garmin activity data.
     * @param rawData Raw FIT file data.
     */
    parseFitFile = async (user: UserData, activity: GarminActivity, rawData: any): Promise<void> => {
        return new Promise((resolve, reject) => {
            try {
                const fitParser = new FitParser({force: true})
                fitParser.parse(rawData, async (err, fitData) => {
                    try {
                        if (err) {
                            logger.error("Garmin.parseFitFile", logHelper.user(user), logHelper.garminActivity(activity), err)
                            reject(err)
                            return
                        }

                        // Extract duration and distance from sessions.
                        if (fitData.sessions?.length > 0) {
                            activity.distance = parseFloat((_.sumBy(fitData.sessions, "total_distance") / 1000).toFixed(1))
                            activity.duration = Math.round(_.sumBy(fitData.sessions, "total_elapsed_time"))
                        }

                        // Found devices in the FIT file? Generate device IDs.
                        if (fitData.devices?.length > 0) {
                            const getDeviceString = (d) => `${d.source_type}.${d.manufacturer}.${d.serial_number}`.replace(/\_/, "")
                            const filterDevices = fitData.devices.filter((d) => d.source_type && d.manufacturer && d.serial_number)
                            activity.devices = _.uniq(filterDevices.map((d) => getDeviceString(d)))
                        }

                        const logDevices = activity.devices ? activity.devices.join(", ") : "none"
                        logger.info("Garmin.parseFitFile", logHelper.user(user), logHelper.garminActivity(activity), `Devices: ${logDevices}`)
                        resolve()
                    } catch (innerEx) {
                        logger.error("Garmin.parseFitFile", logHelper.user(user), logHelper.garminActivity(activity), innerEx)
                        reject(innerEx)
                    }
                })
            } catch (ex) {
                logger.error("Garmin.parseFitFile", logHelper.user(user), logHelper.garminActivity(activity), ex)
                reject(ex)
            }
        })
    }

    /**
     * Save the Garmin profile to the specified user account.
     * @param user The user.
     * @param data The Garmin activity data.
     */
    saveActivity = async (user: UserData, activity: GarminActivity): Promise<void> => {
        try {
            if (!activity.dateExpiry) {
                activity.dateExpiry = dayjs().add(settings.garmin.maxCacheDuration, "seconds").toDate()
            }

            await database.set("garmin", activity, `activity-${activity.id}`)

            const logDevices = activity.devices ? activity.devices.length : "no"
            logger.info("Garmin.saveActivity", logHelper.user(user), logHelper.garminActivity(activity), `${logDevices} devices`)
        } catch (ex) {
            logger.error("Garmin.saveActivity", logHelper.user(user), logHelper.garminActivity(activity), ex)
        }
    }
}

// Exports...
export default GarminActivities.Instance