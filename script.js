/* =========================================================
   DOM ELEMENT REFERENCES
   Grabbing all the elements we'll need to read from or
   write to, once, at the top of the file.
   ========================================================= */

// Search bar elements
const searchInput = document.getElementById("search");
const searchButton = document.getElementById("searchButton");
const errorPopup = document.getElementById("errorPopup");

// Hero section elements (current weather)
const locationEl = document.getElementById("location");
const temperatureEl = document.getElementById("temperatureResult");
const weatherCommentEl = document.getElementById("weatherComment");
const weatherIconEl = document.getElementById("weatherIcon");

// Weather details (humidity / wind / UV) elements
const humidityEl = document.getElementById("weatherHumidityValue");
const windEl = document.getElementById("weatherWindValue");
const uvIndexEl = document.getElementById("weatherUvIndexValue");

// Container that holds the dynamically generated forecast rows
const forecastBox = document.getElementById("forecastBox");

// °C / °F toggle buttons
const unitCButton = document.getElementById("unitC");
const unitFButton = document.getElementById("unitF");

// Search history container (holds quick-access city buttons) + controls
const historyWrapper = document.getElementById("historyWrapper");
const historyContainer = document.getElementById("historyContainer");
const clearHistoryButton = document.getElementById("clearHistoryButton");

/* =========================================================
   CONSTANTS & STATE
   currentUnit / lastWeatherData etc. let us re-render
   already-fetched data (e.g. on unit toggle) without
   hitting the API again.
   ========================================================= */

// localStorage key under which the search history array is saved
const HISTORY_KEY = "weatherSearchHistory";
// Maximum number of cities to remember in the search history
const MAX_HISTORY = 5;

// Which unit is currently displayed: "C" or "F"
let currentUnit = "C";
// The most recent successful API response, kept in memory so the
// unit toggle can re-render instantly without a new network request
let lastWeatherData = null;
// The city/country that lastWeatherData corresponds to
let lastCityName = "";
let lastCountry = "";

/* =========================================================
   UNIT CONVERSION HELPERS
   ========================================================= */

// Converts a Celsius value to Fahrenheit
function celsiusToFahrenheit(celsius) {
  return (celsius * 9) / 5 + 32;
}

// Formats a temperature (always supplied in Celsius by the API)
// into whichever unit is currently selected, rounded to a whole
// number, with the correct ° symbol appended.
function formatTemp(celsiusValue) {
  const value =
    currentUnit === "C" ? celsiusValue : celsiusToFahrenheit(celsiusValue);
  return `${Math.round(value)}°${currentUnit}`;
}

/* =========================================================
   WEATHER CODE TRANSLATION
   Open-Meteo returns a numeric "weather_code" for current
   and forecast conditions. This maps those codes to:
     - a human-readable description
     - a Weather Icons font class (the visual icon)
     - a CSS animation class (defined in styles.css) that
       makes the icon move in a way that matches the weather
   Reference: https://open-meteo.com/en/docs (WMO codes)
   ========================================================= */
function getWeatherDescription(code) {
  if (code === 0) {
    // Clear sky -> spinning sun
    return { description: "Clear Sky", iconClass: "wi wi-day-sunny", animationClass: "icon-spin" };
  } else if ([1, 2, 3].includes(code)) {
    // Mainly clear / partly cloudy / overcast -> drifting cloud
    return { description: "Partly Cloudy", iconClass: "wi wi-day-cloudy", animationClass: "icon-drift" };
  } else if ([45, 48].includes(code)) {
    // Fog / depositing rime fog -> slow pulse, like fog rolling in
    return { description: "Foggy", iconClass: "wi wi-fog", animationClass: "icon-pulse" };
  } else if ([51, 53, 55].includes(code)) {
    // Drizzle (light/moderate/dense) -> bouncing drop
    return { description: "Drizzle", iconClass: "wi wi-sprinkle", animationClass: "icon-bounce" };
  } else if ([61, 63, 65].includes(code)) {
    // Rain (slight/moderate/heavy) -> bouncing drop
    return { description: "Rain", iconClass: "wi wi-rain", animationClass: "icon-bounce" };
  } else if ([71, 73, 75].includes(code)) {
    // Snow (slight/moderate/heavy) -> gentle drift, like snow swaying down
    return { description: "Snow", iconClass: "wi wi-snow", animationClass: "icon-drift" };
  } else if ([80, 81, 82].includes(code)) {
    // Rain showers (slight/moderate/violent) -> bouncing drop
    return { description: "Rain Showers", iconClass: "wi wi-showers", animationClass: "icon-bounce" };
  } else if (code === 95) {
    // Thunderstorm -> flickering flash, like lightning
    return { description: "Thunderstorm", iconClass: "wi wi-thunderstorm", animationClass: "icon-flash" };
  } else {
    // Fallback for any other/unlisted code (e.g. thunderstorm with hail)
    return { description: "Cloudy", iconClass: "wi wi-cloudy", animationClass: "icon-drift" };
  }
}

// Converts a numeric UV index into a human-friendly label,
// following the standard WHO UV Index scale.
function getUvLabel(uv) {
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very High";
  return "Extreme";
}

/* =========================================================
   UI AIDS
   Small functions for showing/hiding errors and toggling
   the search button's loading state.
   ========================================================= */

// Displays the error popup with a custom message
function showError(message) {
  errorPopup.textContent = message;
  errorPopup.style.display = "block";
}

// Hides and clears the error popup
function clearError() {
  errorPopup.style.display = "none";
  errorPopup.textContent = "";
}

// Disables the search button and shows "Loading..." while a
// fetch is in progress, to give the user feedback and prevent
// duplicate submissions.
function setLoading(isLoading) {
  if (isLoading) {
    searchButton.textContent = "Loading...";
    searchButton.disabled = true;
  } else {
    searchButton.textContent = "Search";
    searchButton.disabled = false;
  }
}

/* =========================================================
   API CALLS
   All network requests go through Open-Meteo's free,
   no-API-key-required endpoints, plus BigDataCloud's free
   reverse-geocoding endpoint (used for geolocation lookups,
   since Open-Meteo's own reverse endpoint can intermittently
   fail CORS).
   ========================================================= */

// Looks up a city name and returns its coordinates + canonical
// name/country, using Open-Meteo's forward-geocoding endpoint.
// Throws an Error if the network call fails or no city is found.
async function getCoordinates(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to reach the geocoding service. Please try again.");
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    throw new Error(`City "${city}" not found. Please check the spelling and try again.`);
  }

  const { latitude, longitude, name, country } = data.results[0];
  return { lat: latitude, lon: longitude, name, country };
}

// Reverse-geocodes coordinates (from the browser's Geolocation API)
// into a city/country name, using BigDataCloud's free client-side
// reverse geocoding endpoint. Throws an Error if the request fails;
// the caller is responsible for falling back gracefully.
async function getCityFromCoordinates(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to determine your city from your location.");
  }

  const data = await response.json();

  // Different regions populate different fields, so fall back through
  // a few options before giving up on a usable name.
  const name = data.city || data.locality || data.principalSubdivision || "Your Location";
  const country = data.countryName || "";

  return { name, country };
}

// Fetches current conditions + 5-day daily forecast for a given
// latitude/longitude from Open-Meteo. Always returns temperatures
// in Celsius — unit conversion for display happens client-side in
// formatTemp(), so we never need to re-fetch when toggling units.
async function getWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max` +
    `&timezone=auto`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to retrieve weather data. Please try again.");
  }

  return await response.json();
}

/* =========================================================
   RENDERING
   Functions that take fetched data and write it into the DOM.
   These are unit-aware (via formatTemp) and re-runnable, so
   they're also used by the °C/°F toggle to re-render without
   a new fetch.
   ========================================================= */

// Updates the hero card: icon (with animation), location,
// current temperature, and the description/feels-like line.
function displayCurrentWeather(current, daily, cityName, country) {
  const { description, iconClass, animationClass } = getWeatherDescription(current.weather_code);
  const uvMax = daily.uv_index_max ? Math.round(daily.uv_index_max[0]) : 5;

  locationEl.textContent = country ? `${cityName}, ${country}` : cityName;
  temperatureEl.textContent = formatTemp(current.temperature_2m);
  weatherCommentEl.textContent = `${description} · Feels like ${formatTemp(current.apparent_temperature)}`;

  // Combine the static icon glyph class with the dynamic CSS
  // animation class so the icon both looks right AND moves.
  weatherIconEl.innerHTML = `<i class="${iconClass} ${animationClass}"></i>`;

  humidityEl.textContent = `${current.relative_humidity_2m}%`;
  windEl.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
  uvIndexEl.textContent = getUvLabel(uvMax);
}

// Clears and rebuilds the 5-day forecast list from the "daily"
// portion of the API response.
function displayForecast(daily) {
  forecastBox.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const date = new Date(daily.time[i]);
    // First day is always labeled "Today" instead of its weekday name
    const dayName =
      i === 0
        ? "Today"
        : date.toLocaleDateString("en-US", { weekday: "long" });

    const { iconClass } = getWeatherDescription(daily.weather_code[i]);

    const row = document.createElement("div");
    row.className = "forecast-container-row";
    row.innerHTML = `
      <p>${dayName}</p>
      <i class="${iconClass}"></i>
      <div class="forecast-temperature">
        <p>${formatTemp(daily.temperature_2m_max[i])}</p>
        <p>${formatTemp(daily.temperature_2m_min[i])}</p>
      </div>
    `;

    forecastBox.appendChild(row);
  }
}

// Re-renders the current weather + forecast using whatever data
// is already stored in memory (lastWeatherData). Used by the unit
// toggle so switching °C/°F is instant and makes no network call.
function renderStoredWeather() {
  if (!lastWeatherData) return;
  displayCurrentWeather(lastWeatherData.current, lastWeatherData.daily, lastCityName, lastCountry);
  displayForecast(lastWeatherData.daily);
}

/* =========================================================
   °C / °F UNIT TOGGLE (feature)
   ========================================================= */

// Switches the active unit, updates which toggle button looks
// "active", and re-renders the already-fetched weather data in
// the new unit. Does nothing if the requested unit is already active.
function setUnit(unit) {
  if (unit === currentUnit) return;
  currentUnit = unit;

  unitCButton.classList.toggle("active", unit === "C");
  unitFButton.classList.toggle("active", unit === "F");

  renderStoredWeather();
}

/* =========================================================
   SEARCH HISTORY (feature)
   Stores up to the last 5 searched city names in localStorage
   so they persist across page reloads, and renders them as
   clickable quick-access buttons.
   ========================================================= */

// Reads the saved history array from localStorage.
// Returns an empty array if nothing is saved yet, or if the
// stored value is corrupted/unparsable.
function getHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

// Adds a city to the front of the history list, removing any
// existing duplicate (case-insensitive) so it doesn't appear
// twice, then trims the list down to MAX_HISTORY entries.
// Saves the result back to localStorage and refreshes the UI.
function saveToHistory(cityName) {
  if (!cityName) return;

  let history = getHistory();

  history = history.filter(
    (city) => city.toLowerCase() !== cityName.toLowerCase()
  );

  history.unshift(cityName); // add newest entry to the front
  history = history.slice(0, MAX_HISTORY); // keep only the most recent 5

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

// Rebuilds the row of history buttons from localStorage.
// Clicking a city button fills the search box with that city and
// immediately re-runs the search (no new typing required).
// Hides the entire wrapper (including the "Clear" button) when
// there's no history to show.
function renderHistory() {
  const history = getHistory();
  historyContainer.innerHTML = "";

  historyWrapper.style.display = history.length === 0 ? "none" : "flex";

  history.forEach((cityName) => {
    const button = document.createElement("button");
    button.className = "history-btn";
    button.type = "button";
    button.textContent = cityName;
    button.addEventListener("click", () => {
      searchInput.value = cityName;
      handleSearch();
    });
    historyContainer.appendChild(button);
  });
}

// Wipes the saved search history from localStorage and refreshes
// the UI (hiding the history row entirely, since it's now empty).
function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

/* =========================================================
   SEARCH FLOW (manual city search)
   ========================================================= */

// Triggered by the Search button (or Enter key). Looks up the
// typed city, fetches its weather, renders everything, and
// records the city in search history. Shows an error message
// for empty input, an unknown city, or a network failure.
async function handleSearch() {
  const city = searchInput.value.trim();

  if (!city) {
    showError("Please enter a city name.");
    return;
  }

  clearError();
  setLoading(true);

  try {
    const { lat, lon, name, country } = await getCoordinates(city);
    const weatherData = await getWeather(lat, lon);

    // Cache the result so the unit toggle can reuse it later
    lastWeatherData = weatherData;
    lastCityName = name;
    lastCountry = country;

    displayCurrentWeather(weatherData.current, weatherData.daily, name, country);
    displayForecast(weatherData.daily);

    // Only successful, explicit searches get added to history
    // (geolocation-based auto-loads do not).
    saveToHistory(name);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

/* =========================================================
   GEOLOCATION FLOW (automatic weather on page load)
   ========================================================= */

// Given coordinates from the browser's Geolocation API, resolves
// a friendly city name (best effort) and fetches/display the
// weather for that location. If reverse geocoding fails, the
// weather still loads — it just shows "Your Location" instead
// of a city name, so a geocoding hiccup never blocks the
// core feature from working.
async function loadWeatherByCoordinates(lat, lon) {
  clearError();
  setLoading(true);

  let name = "Your Location";
  let country = "";
  try {
    const cityInfo = await getCityFromCoordinates(lat, lon);
    name = cityInfo.name;
    country = cityInfo.country;
  } catch (geoError) {
    // Non-fatal: log it for debugging, but keep going with the fallback name
    console.warn("Reverse geocoding failed, continuing without a city name:", geoError.message);
  }

  try {
    const weatherData = await getWeather(lat, lon);

    lastWeatherData = weatherData;
    lastCityName = name;
    lastCountry = country;

    displayCurrentWeather(weatherData.current, weatherData.daily, name, country);
    displayForecast(weatherData.daily);
    searchInput.value = name; // reflect the detected city in the search box
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

// Manual search via button click or pressing Enter in the input
searchButton.addEventListener("click", handleSearch);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleSearch();
  }
});

// °C / °F toggle buttons
unitCButton.addEventListener("click", () => setUnit("C"));
unitFButton.addEventListener("click", () => setUnit("F"));

// "Clear history" button
clearHistoryButton.addEventListener("click", clearHistory);

/* =========================================================
   INITIAL PAGE LOAD
   On load we:
     1. Render any previously saved search history.
     2. Try to detect the user's location via the browser's
        Geolocation API and show local weather automatically.
     3. If geolocation is denied, unavailable, or unsupported,
        fall back to a default city search ("Lagos") so the
        app never loads in an empty/broken state.
   ========================================================= */
window.addEventListener("DOMContentLoaded", () => {
  renderHistory();

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      // Success callback: got coordinates, load weather for them
      (position) => {
        const { latitude, longitude } = position.coords;
        loadWeatherByCoordinates(latitude, longitude);
      },
      // Error callback: permission denied, timeout, or position unavailable
      () => {
        searchInput.value = "Lagos";
        handleSearch();
      },
      // Options: don't need GPS-level precision, and don't wait too long
      { enableHighAccuracy: false, timeout: 10000 }
    );
  } else {
    // Browser doesn't support the Geolocation API at all
    searchInput.value = "Lagos";
    handleSearch();
  }
});