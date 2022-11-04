// Strautomator Core: Recipes

import {recipePropertyList, recipeActionList} from "./lists"
import {defaultAction, booleanAction, gearAction, mapStyleAction, sportTypeAction, webhookAction, workoutTypeAction} from "./actions"
import {checkBoolean, checkGear, checkLocation, checkNewRecords, checkNumber, checkSportType, checkSpotify, checkText, checkTimestamp, checkWeather, checkWeekday} from "./conditions"
import {RecipeAction, RecipeActionType, RecipeCondition, RecipeData, RecipeOperator} from "./types"
import {StravaActivity} from "../strava/types"
import {UserData} from "../users/types"
import database from "../database"
import eventManager from "../eventmanager"
import recipeStats from "./stats"
import _ = require("lodash")
import logger = require("anyhow")
import dayjs from "../dayjs"
const settings = require("setmeup").settings

/**
 * Evaluate and process automation recipes.
 */
export class Recipes {
    private constructor() {}
    private static _instance: Recipes
    static get Instance() {
        return this._instance || (this._instance = new this())
    }

    /**
     * Recipe stats.
     */
    stats = recipeStats

    /**
     * List of possible property names for conditions.
     */
    get propertyList() {
        return recipePropertyList
    }

    /**
     * List of possible recipe actions.
     */
    get actionList() {
        return recipeActionList
    }

    // INIT
    // --------------------------------------------------------------------------

    /**
     * Init the Recipes Manager.
     */
    init = async () => {
        eventManager.on("Users.delete", this.onUserDelete)
    }

    /**
     * Delete user recipe stats after it gets deleted from the database.
     * @param user User that was deleted from the database.
     */
    private onUserDelete = async (user: UserData): Promise<void> => {
        try {
            const counter = await database.delete("recipe-stats", ["userId", "==", user.id])

            if (counter > 0) {
                logger.info("Recipes.onUsersDelete", `User ${user.id} ${user.displayName}`, `Deleted ${counter} recipe stats`)
            }
        } catch (ex) {
            logger.error("Recipes.onUsersDelete", `User ${user.id} ${user.displayName}`, ex)
        }
    }

    // PROCESSING
    // --------------------------------------------------------------------------

    /**
     * Validate a recipe, mostly called before saving to the database.
     * Will throw an error when something wrong is found.
     * @param recipe The recipe object.
     */
    validate = (recipe: RecipeData): void => {
        try {
            if (!recipe) {
                throw new Error("Recipe is empty")
            }

            if (!recipe.title) {
                throw new Error("Missing recipe title")
            }

            if (recipe.title.length > settings.recipes.maxLength.title) {
                throw new Error(`Recipe title is too long (max length is ${settings.recipes.maxLength.title})`)
            }

            if (recipe.order && isNaN(recipe.order)) {
                throw new Error("Recipe order must be a number")
            }

            if (_.isArray(recipe.actions)) {
                recipe.actions = recipe.actions.filter((a) => !_.isEmpty(a))
            } else {
                throw new Error("Missing recipe actions")
            }

            if (_.isArray(recipe.conditions)) {
                recipe.conditions = recipe.conditions.filter((c) => !_.isEmpty(c))
            }

            // Default recipes for a specific sport type should have no conditions, and order 0.
            if (recipe.defaultFor) {
                recipe.order = 0
                recipe.conditions = []
            }
            // Non-default recipes must have conditions defined.
            else {
                if (!_.isArray(recipe.conditions)) {
                    throw new Error("Missing recipe conditions")
                }

                // Parse recipe conditions.
                for (let condition of recipe.conditions) {
                    if (!condition.property) {
                        throw new Error(`Missing condition property`)
                    }
                    if (!Object.values(RecipeOperator).includes(condition.operator)) {
                        throw new Error(`Invalid condition operator: ${condition.operator}`)
                    }
                    if (condition.value === null || condition.value === "") {
                        throw new Error(`Missing condition value`)
                    }
                    if (_.isString(condition.value) && (condition.value as string).length > settings.recipes.maxLength.conditionValue) {
                        throw new Error(`Condition value is too long (max length is ${settings.recipes.maxLength.conditionValue})`)
                    }
                    if (condition.friendlyValue && _.isString(condition.friendlyValue) && (condition.friendlyValue as string).length > settings.recipes.maxLength.conditionValue) {
                        throw new Error(`Condition friendly value is too long (max length is ${settings.recipes.maxLength.conditionValue})`)
                    }

                    // Check numbers.
                    const propSpecs = recipePropertyList.find((p) => p.value == condition.property)
                    if (propSpecs && propSpecs.type == "number" && isNaN(condition.value as any)) {
                        throw new Error(`Condition ${condition.property} must be a valid number`)
                    }

                    // Check for non-schema fields.
                    const keys = Object.keys(condition)
                    for (let key of keys) {
                        if (!["property", "operator", "value", "friendlyValue"].includes(key)) {
                            throw new Error(`Invalid field: ${key}`)
                        }
                    }
                }
            }

            // Parse recipe actions.
            for (let action of recipe.actions) {
                if (!Object.values(RecipeActionType).includes(action.type)) {
                    throw new Error(`Invalid action type: ${action.type}`)
                }

                // Some actions must have a value.
                if (action.type != RecipeActionType.Commute) {
                    if (action.value === null || action.value === "") {
                        throw new Error(`Missing action value`)
                    }
                }

                // Webhook value must be an URL.
                if (action.type == RecipeActionType.Webhook) {
                    const isUrl = /(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/.test(action.value)
                    if (!isUrl) {
                        throw new Error(`Webhook URL is not valid`)
                    }
                }

                if (action.value && _.isString(action.value) && (action.value as string).length > settings.recipes.maxLength.actionValue) {
                    throw new Error(`Action value is too long (max length is ${settings.recipes.maxLength.actionValue})`)
                }

                // Check for non-schema fields.
                const keys = Object.keys(action)
                for (let key of keys) {
                    if (!["type", "value", "friendlyValue"].includes(key)) {
                        throw new Error(`Invalid field: ${key}`)
                    }
                }
            }
        } catch (ex) {
            logger.error("Recipes.validate", JSON.stringify(recipe, null, 0), ex)
            throw ex
        }
    }

    /**
     * Evaluate the activity against the defined conditions and actions,
     * and return the updated Strava activity.
     * @param user The recipe's owner.
     * @param id The recipe ID.
     * @param activity Strava activity to be evaluated.
     */
    evaluate = async (user: UserData, id: string, activity: StravaActivity): Promise<boolean> => {
        const recipe: RecipeData = user.recipes[id]

        if (!recipe) {
            throw new Error(`Recipe ${id} not found`)
        }

        // Recipe disabled? Stop here.
        if (recipe.disabled) {
            logger.info("Recipes.evaluate", `User ${user.id}`, `Activity ${activity.id}`, `Recipe ${recipe.id} is disabled`)
            return false
        }

        // If recipe is default for a sport, check the type.
        if (recipe.defaultFor) {
            if (activity.sportType != recipe.defaultFor) {
                return false
            }
        }

        // Otherwise iterate conditions and evaluate each one.
        else {
            logger.info("Recipes.evaluate", `User ${user.id}`, `Activity ${activity.id}`, `Recipe ${recipe.id} - ${recipe.title}`, `Will check ${recipe.conditions.length} conditions`)

            for (let condition of recipe.conditions) {
                const valid = await this.checkCondition(user, activity, recipe, condition)

                // Recipe not valid for this activity? Log what failed.
                // Polyline contents won't be logged.
                if (!valid) {
                    let conditionProp = condition.property == "polyline" ? null : activity[condition.property]
                    if (_.isDate(conditionProp)) conditionProp = dayjs(conditionProp).format("lll")
                    else if (_.isArray(conditionProp)) conditionProp = conditionProp.length

                    let logValue = conditionProp ? `Not a match: ${conditionProp}` : "Not a match"
                    logger.info("Recipes.evaluate", `User ${user.id}`, `Activity ${activity.id}`, `Recipe ${recipe.id}`, `${condition.property} ${condition.operator} ${condition.value}`, logValue)
                    return false
                }
            }
        }

        const logEvaluated = recipe.defaultFor ? `default for ${recipe.defaultFor}` : recipe.conditions.map((c) => `${c.property}: ${activity[c.property] ? activity[c.property].id || activity[c.property] : c.value}`).join(" | ")
        logger.info("Recipes.evaluate", `User ${user.id}`, `Activity ${activity.id}`, `Recipe ${recipe.id} - ${recipe.title}`, "Evaluated", logEvaluated)

        // Sort recipe actions, webhook should come last.
        const sortedActions = _.sortBy(recipe.actions, ["type"])

        // Iterate and execute actions.
        let success: boolean = true
        for (let action of sortedActions) {
            success = success && (await this.processAction(user, activity, recipe, action))
        }

        // Update recipe stats.
        await recipeStats.updateStats(user, recipe, activity, success)

        return true
    }

    /**
     * Check if the passed condition is valid for the activity.
     * @param user The recipe's owner.
     * @param activity Strava activity to be evaluated.
     * @param recipe Recipe being evaluated.
     * @param condition The recipe condition.
     */
    checkCondition = async (user: UserData, activity: StravaActivity, recipe: RecipeData, condition: RecipeCondition): Promise<boolean> => {
        try {
            const prop = condition.property

            // Weather conditions.
            if (prop.includes("weather")) {
                const valid = await checkWeather(user, activity, condition)
                if (!valid) return false
            }

            // Spotify conditions.
            else if (prop.includes("spotify")) {
                const valid = await checkSpotify(user, activity, condition)
                if (!valid) return false
            }

            // Location condition.
            else if (prop.indexOf("location") == 0 || prop == "polyline") {
                const valid = checkLocation(activity, condition)
                if (!valid) return false
            }

            // Sport type condition.
            else if (prop == "sportType") {
                const valid = checkSportType(activity, condition)
                if (!valid) return false
            }

            // Gear condition.
            else if (prop == "gear") {
                const valid = checkGear(activity, condition)
                if (!valid) return false
            }

            // New records?
            else if (prop == "newRecords" || prop == "komSegments" || prop == "prSegments") {
                const valid = checkNewRecords(activity, condition)
                if (!valid) return false
            }

            // Day of week condition.
            else if (prop == "weekday") {
                const valid = checkWeekday(activity, condition)
                if (!valid) return false
            }

            // Time based condition.
            else if (prop.indexOf("date") == 0 || prop.indexOf("Time") > 0) {
                const valid = checkTimestamp(activity, condition)
                if (!valid) return false
            }

            // Number condition.
            else if (_.isNumber(activity[condition.property])) {
                const valid = checkNumber(activity, condition)
                if (!valid) return false
            }

            // Boolean condition.
            else if (_.isBoolean(condition.value)) {
                const valid = checkBoolean(activity, condition)
                if (!valid) return false
            }

            // Text condition (default).
            else {
                const valid = checkText(activity, condition)
                if (!valid) return false
            }

            logger.debug("Recipes.checkCondition", `User ${user.id} ${user.displayName}`, `Activity ${activity.id}`, `Recipe ${recipe.id}`, `${condition.property} ${condition.operator} ${condition.value}`)
            return true
        } catch (ex) {
            logger.error("Recipes.checkCondition", `User ${user.id} ${user.displayName}`, `Activity ${activity.id}`, `Recipe ${recipe.id}`, `${condition.property} ${condition.operator} ${condition.value}`, ex)
            return false
        }
    }

    /**
     * Process a value string against an activity and return the final result.
     * @param user The user (owner of the activity).
     * @param activity A Strava activity.
     * @param recipe The source recipe.
     * @param action Recipe action to be executed.
     */
    processAction = async (user: UserData, activity: StravaActivity, recipe: RecipeData, action: RecipeAction): Promise<boolean> => {
        logger.debug("Recipes.processAction", user, activity, action)

        if (!activity.updatedFields) {
            activity.updatedFields = []
        }

        // Mark activity as commute?
        if (action.type == RecipeActionType.Commute || action.type == RecipeActionType.HideHome || action.type.toString().substring(0, 8) == "hideStat") {
            return booleanAction(user, activity, recipe, action)
        }

        // Change activity gear?
        else if (action.type == RecipeActionType.Gear) {
            return gearAction(user, activity, recipe, action)
        }

        // Change activity / sport type?
        else if (action.type == RecipeActionType.SportType) {
            return sportTypeAction(user, activity, recipe, action)
        }

        // Change activity workout type?
        else if (action.type == RecipeActionType.WorkoutType) {
            return workoutTypeAction(user, activity, recipe, action)
        }

        // Change activity map style?
        else if (action.type == RecipeActionType.MapStyle) {
            return mapStyleAction(user, activity, recipe, action)
        }

        // Dispatch activity to webhook?
        else if (action.type == RecipeActionType.Webhook) {
            return webhookAction(user, activity, recipe, action)
        }

        // Other actions (set description or name).
        return defaultAction(user, activity, recipe, action)
    }

    /**
     * String representation of the recipe.
     * @param recipe The recipe to get the summary for.
     */
    getSummary = (recipe: RecipeData): string => {
        const result = []

        for (let condition of recipe.conditions) {
            result.push(`${condition.property} ${condition.operator} ${condition.value}`)
        }

        for (let action of recipe.actions) {
            result.push(`${action.type}: ${action.value}`)
        }

        return result.join(", ")
    }

    /**
     * String representation of a recipe action.
     * @param action The recipe action to get the summary for.
     */
    getActionSummary = (action: RecipeAction): string => {
        const actionType = _.find(recipeActionList, {value: action.type}).text
        const valueText = action.friendlyValue || action.value

        if (action.value && action.type != "commute") {
            return `${actionType}: ${valueText}`
        } else {
            return `${actionType}`
        }
    }

    /**
     * String representation of a recipe condition.
     * @param condition The recipe condition to get the summary for.
     */
    getConditionSummary = (condition: RecipeCondition): string => {
        const property = _.find(recipePropertyList, {value: condition.property})
        const fieldText = property.text
        const operatorText = _.find(property.operators, {value: condition.operator}).text
        let valueText = condition.friendlyValue || condition.value

        if (property.suffix) {
            valueText += ` ${property.suffix}`
        }

        return `${fieldText} ${operatorText} ${valueText}`
    }
}

// Exports...
export default Recipes.Instance
