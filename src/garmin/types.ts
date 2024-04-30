// Strautomator Core: Garmin types

/**
 * Garmin linked profile details.
 */
export interface GarminProfile {
    /** Garmin user ID. */
    id: string
    /** Garmin tokens. */
    tokens: GarminTokens
}

/**
 * Garmin authentication tokens.
 */
export interface GarminTokens {
    /** Access token. */
    accessToken: string
    /** Access token secret. */
    tokenSecret: string
    /** Token repeated failure count. */
    failureCount?: number
}

/**
 * Activity details from Garmin. Transformed from GarminPingActivity.
 */
export interface GarminActivity {
    /** Activity ID (same as activityId). */
    id: string
    /** User ID (from Strava, not from Garmin). */
    userId: string
    /** Profile ID (user ID from Garmin). */
    profileId: string
    /** Activity name (same as activityName). */
    name: string
    /** Activity duration in seconds. */
    totalTime?: number
    /** Activity distance in KM. */
    distance?: number
    /** Activity primary benefit.*/
    primaryBenefit?: string
    /** Training stress score. */
    tss?: number
    /** Training load. */
    trainingLoad?: number
    /** Intensity factor. */
    intensityFactor?: number
    /** Aerobic training effect. */
    aerobicTrainingEffect?: number
    /** Anaerobic training effect. */
    anaerobicTrainingEffect?: number
    /** Pedal L/R avg. torque effectiveness (0-100). */
    pedalTorqueEffect?: number
    /** Pedal L/R avg. smoothness (0-100). */
    pedalSmoothness?: number
    /** Pedal L/R balance. */
    pedalBalance?: string
    /** The Sport profile used in the Garmin device. */
    sportProfile?: string
    /** Devices used in the activity. */
    devices?: string[]
    /** Activity UTC start date. */
    dateStart?: Date
    /** Date when it should expire (used for the Firestore TTL). */
    dateExpiry?: Date
}

/**
 * Webhooks dispatched by Garmin.
 */
export interface GarminWebhookData {
    /** Activity files data. */
    activityFiles?: GarminPingActivityFile[]
    /** Deregistrations data. */
    deregistrations?: GarminPing[]
    /** User permissions change data. */
    userPermissionsChange?: GarminPingPermissions[]
}

/**
 * Base ping data from Garmin.
 */
export interface GarminPing {
    /** User ID (from Garmin). */
    userId?: string
    /** User access token. */
    userAccessToken?: string
}

/**
 * Activity details from Garmin. Mostly the same schema as the ping
 * from Garmin, expect the appended dateStart and devices.
 */
export interface GarminPingActivityFile extends GarminPing {
    /** Activity unique ID. */
    activityId?: string
    /** Activity name on Garmin. */
    activityName?: string
    /** Callback URL to download the file. */
    callbackURL?: string
    /** File type. */
    fileType?: string
    /** Activity timestamp. */
    startTimeInSeconds?: number
}

/**
 * An user permissions change ping from Garmin.
 */
export interface GarminPingPermissions extends GarminPing {
    /** List of updated permissions. */
    permissions?: string[]
}

/**
 * OAuth1 metadata.
 */
export interface OAuth1Data {
    oauth_timestamp: number
    oauth_nonce: string
    oauth_consumer_key: string
    oauth_version: string
    oauth_verifier?: string
    oauth_token?: string
    oauth_body_hash?: string
    oauth_signature?: string
    oauth_signature_method?: string
}

/**
 * OAuth1 token and secret.
 */
export interface OAuth1Token {
    oauth_token: string
    oauth_token_secret: string
}
