/** ENDPOINTS */
export const FEDEX_TRACKING_ENDPOINT = '/track/v1/trackingnumbers';
export const FEDEX_AUTHENTICATION_ENDPOINT = '/oauth/token';

export const FEDEX_HEADERS = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
});

export const FEDEX_AUTH_HEADERS = () => ({
    'Content-Type': 'application/x-www-form-urlencoded'
});