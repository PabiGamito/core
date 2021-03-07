// Strautomator Core: Weather - OpenWeatherMap

import {WeatherApiStats, WeatherProvider, WeatherSummary} from "./types"
import {processWeatherSummary, weatherSummaryString} from "./utils"
import {UserPreferences} from "../users/types"
import {axiosRequest} from "../axios"
import logger = require("anyhow")
import moment = require("moment")
const settings = require("setmeup").settings

/**
 * OpenWeatherMap weather API. Only supports ccurrent weather (no historical data).
 */
export class OpenWeatherMap implements WeatherProvider {
    private constructor() {}
    private static _instance: OpenWeatherMap
    static get Instance(): OpenWeatherMap {
        return this._instance || (this._instance = new this())
    }
    apiRequest = null
    stats: WeatherApiStats = null

    name: string = "openweathermap"
    title: string = "OpenWeatherMap"
    maxHours: number = 1

    // METHODS
    // --------------------------------------------------------------------------

    /**
     * Get current weather conditions for the specified coordinates.
     * @param coordinates Array with latitude and longitude.
     * @param preferences User preferences to get proper weather units.
     */
    getWeather = async (coordinates: [number, number], date: Date, preferences: UserPreferences): Promise<WeatherSummary> => {
        const unit = preferences && preferences.weatherUnit == "f" ? "imperial" : "metric"
        const isoDate = date.toISOString()

        try {
            if (!preferences) preferences = {}
            if (moment.utc().diff(date, "hours") > this.maxHours) throw new Error(`Date out of range: ${isoDate}`)

            const baseUrl = settings.weather.openweathermap.baseUrl
            const secret = settings.weather.openweathermap.secret
            const lang = preferences.language || "en"
            const weatherUrl = `${baseUrl}?appid=${secret}&units=metric&lang=${lang}&lat=${coordinates[0]}&lon=${coordinates[1]}`

            // Fetch weather data.
            logger.debug("OpenWeatherMap.getWeather", weatherUrl)
            const res = await this.apiRequest.schedule(() => axiosRequest({url: weatherUrl}))

            // Parse result.
            const result = this.toWeatherSummary(res, date, preferences)
            if (result) {
                logger.info("OpenWeatherMap.getWeather", weatherSummaryString(coordinates, date, result))
            }

            return result
        } catch (ex) {
            logger.error("OpenWeatherMap.getWeather", coordinates, isoDate, unit, ex)
            this.stats.errorCount++
            throw ex
        }
    }

    /**
     * Transform data from the OpenWeatherMap API to a WeatherSummary.
     * @param data Data from OpenWeatherMap.
     * @param preferences User preferences.
     */
    private toWeatherSummary = (data: any, date: Date, preferences: UserPreferences): WeatherSummary => {
        logger.debug("OpenWeatherMap.toWeatherSummary", data, date, preferences.weatherUnit)

        // Check if received data is valid.
        if (!data) return

        const weatherData = data.weather[0]
        const code = weatherData.icon.substring(1)

        // Get correct icon text based on the weather code.
        let iconText = "clear"
        switch (code) {
            case "2":
                iconText = "thunderstorm"
                break
            case "3":
            case "5":
                iconText = "rain"
                break
            case "6":
                iconText = ["610", "611"].indexOf(weatherData.id) < 0 ? "snow" : "sleet"
                break
            case "7":
                iconText = "fog"
                break
            case "8":
                iconText = ["800", "801"].indexOf(weatherData.id) < 0 ? "cloudy" : "clear-day"
                break
            case "9":
                iconText = "rain"
                break
            default:
                iconText = "cloudy"
        }

        // Get snow or rain.
        const mmSnow = data.snow ? data.snow["1h"] : 0
        const mmRain = data.rain ? data.rain["1h"] : 0

        const result: WeatherSummary = {
            summary: weatherData.description,
            temperature: data.main.temp,
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            windSpeed: data.wind.speed,
            windDirection: data.wind.deg,
            precipitation: data.snow && data.snow["1h"] ? "snow" : data.rain ? "rain" : null,
            cloudCover: data.clouds ? data.clouds.all : null,
            extraData: {
                iconText: iconText,
                mmPrecipitation: mmSnow || mmRain,
                visibility: data.visibility
            }
        }

        // Process and return weather summary.
        processWeatherSummary(result, date, preferences)
        return result
    }
}

// Exports...
export default OpenWeatherMap.Instance
