// Strautomator Core: Subscriptions

import {BaseSubscription} from "./types"
import {UserData} from "../users/types"
import {GitHubSubscription} from "../github/types"
import {PayPalSubscription} from "../paypal/types"
import database from "../database"
import logger from "anyhow"
import * as logHelper from "../loghelper"
import dayjs from "../dayjs"
const settings = require("setmeup").settings

/**
 * Manage PRO subscriptions.
 */
export class Subscriptions {
    private constructor() {}
    private static _instance: Subscriptions
    static get Instance() {
        return this._instance || (this._instance = new this())
    }

    // INIT
    // --------------------------------------------------------------------------

    /**
     * Init the subscriptions manager.
     * @param quickStart If true, will not get the changelog from the repo releases.
     */
    init = async (): Promise<void> => {
        try {
            const count = await database.count("subscriptions")
            logger.info("Subscriptions.init", `There are ${count} subscriptions`)
        } catch (ex) {
            logger.error("Subscriptions.init", ex)
            throw ex
        }
    }

    // GET SUBSCRIPTIONS
    // --------------------------------------------------------------------------

    /**
     * Get a subscription by its ID. If not found, returns null.
     * @param id The user's ID.
     */
    getById = async (id: string): Promise<BaseSubscription | PayPalSubscription | GitHubSubscription> => {
        try {
            return await database.get("subscriptions", id)
        } catch (ex) {
            logger.error("Subscriptions.getById", id, ex)
            throw ex
        }
    }

    /**
     * Get non-active subscriptions.
     */
    getNonActive = async (): Promise<(BaseSubscription | PayPalSubscription | GitHubSubscription)[]> => {
        try {
            const where = [["status", "in", ["SUSPENDED", "CANCELLED", "EXPIRED"]]]
            const subscriptions: (BaseSubscription | PayPalSubscription | GitHubSubscription)[] = await database.search("subscriptions", where)
            logger.info("Subscriptions.getNonActive", `Got ${subscriptions.length} non-active subscriptions`)

            return subscriptions
        } catch (ex) {
            logger.error("Subscriptions.getNonActive", ex)
            throw ex
        }
    }

    /**
     * Get all dangling user subscriptions (user clicked to subscribed but never finished the process).
     */
    getDangling = async (): Promise<(BaseSubscription | PayPalSubscription | GitHubSubscription)[]> => {
        try {
            const minDate = dayjs.utc().add(settings.users.subscriptionDays.dangling, "days").toDate()
            const queries = [
                ["dateUpdated", "<", minDate],
                ["status", "==", "APPROVAL_PENDING"]
            ]

            const subscriptions: PayPalSubscription[] = await database.search("subscriptions", queries)
            logger.info("Subscriptions.getDangling", `Got ${subscriptions.length} dangling subscriptions`)

            return subscriptions
        } catch (ex) {
            logger.error("Subscriptions.getDangling", ex)
            throw ex
        }
    }

    /**
     * Get subscriptions for the specified user.
     * @param user The user to get the subscriptions for.
     */
    getByUser = async (user: UserData): Promise<(BaseSubscription | PayPalSubscription | GitHubSubscription)[]> => {
        try {
            const where = [["userId", "in", user.id]]
            const subscriptions: (BaseSubscription | PayPalSubscription | GitHubSubscription)[] = await database.search("subscriptions", where)
            logger.info("Subscriptions.getByUser", logHelper.user(user), `Got ${subscriptions.length} subscriptions`)

            return subscriptions
        } catch (ex) {
            logger.error("Subscriptions.getByUser", logHelper.user(user), ex)
            throw ex
        }
    }

    // UPDATE SUBSCRIPTIONS
    // --------------------------------------------------------------------------

    /**
     * Create a new user subscription.
     * @param subscription The subscription to be created.
     */
    create = async (subscription: Partial<BaseSubscription | PayPalSubscription | GitHubSubscription>): Promise<void> => {
        try {
            subscription.dateCreated = new Date()
            subscription.dateUpdated = new Date()

            await database.set("subscriptions", subscription, subscription.id)
            logger.info("Subscriptions.create", `User ${subscription.userId}`, subscription.id, subscription.source, subscription.currency, subscription.frequency)
        } catch (ex) {
            logger.error("Subscriptions.create", `User ${subscription.userId}`, subscription.id, ex)
            throw ex
        }
    }

    /**
     * Update the specified subscription.
     * @param subscription The subscription to be updated.
     */
    update = async (subscription: Partial<BaseSubscription | PayPalSubscription | GitHubSubscription>): Promise<void> => {
        try {
            const logs = []

            if (subscription.currency) {
                logs.push(`Currency: ${subscription.currency}`)
            }
            if (subscription.frequency) {
                logs.push(`Frequency: ${subscription.frequency}`)
            }
            if (subscription.price) {
                logs.push(`Price: ${subscription.price}`)
            }
            if (subscription.status) {
                logs.push(`Status: ${subscription.status}`)
            }

            await database.merge("subscriptions", subscription)
            logger.info("Subscriptions.update", `User ${subscription.userId}`, subscription.id, logs.join(" | "))
        } catch (ex) {
            logger.error("Subscriptions.update", `User ${subscription.userId}`, subscription.id, ex)
            throw ex
        }
    }

    /**
     * Set the specified active subscription status to "EXPIRED".
     * @param subscription The subscription to be expired.
     */
    expire = async (subscription: BaseSubscription | PayPalSubscription | GitHubSubscription): Promise<void> => {
        try {
            if (subscription.status != "ACTIVE") {
                logger.warn("Subscriptions.expire", `User ${subscription.userId}`, subscription.id, "Subscription is not active, will not expire")
                return
            }

            subscription.status = "EXPIRED"
            await database.merge("subscriptions", {id: subscription.id, status: subscription.status})
            logger.info("Subscriptions.expire", `User ${subscription.userId}`, subscription.id, "Status set to EXPIRED")
        } catch (ex) {
            logger.error("Subscriptions.expire", `User ${subscription.userId}`, subscription.id, ex)
        }
    }

    /**
     * Delete the specified subscription. This method always resolves, as it's not considered critical.
     * @param subscription The subscription to be deleted.
     */
    delete = async (subscription: BaseSubscription | PayPalSubscription | GitHubSubscription): Promise<void> => {
        try {
            const user: UserData = await database.get("users", subscription.userId)

            // Check if the subscription data on the user details should be removed.
            if (!user) {
                logger.warn("Subscriptions.delete", `User ${subscription.userId}`, subscription.id, "User not found")
                return
            }

            // Delete subscription details from the database.
            await database.delete("subscriptions", subscription.id)
            logger.info("Subscriptions.delete", `User ${subscription.userId}`, subscription.id, "Deleted subscription")
        } catch (ex) {
            logger.error("Subscriptions.delete", `User ${subscription.userId}`, subscription.id, ex)
        }
    }
}

// Exports...
export default Subscriptions.Instance
