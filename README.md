# Doginary 🐾

**Weather guidance, daily logging and practical dog knowledge in one place.**

Doginary is a responsive web experience designed to help dog owners understand what their dog may need before every walk. It combines local weather data, a personalized Dog Comfort Index, daily activity logging and evidence-aware guidance in a calm, friendly interface.

## Core idea

Open Doginary and quickly answer three questions:

1. Is it a good time to walk?
2. What should I consider for my dog today?
3. What have I logged for my dog recently?

## Features

- 🌤️ Local weather forecast for dog walks
- 🐾 Personalized Dog Comfort Index
- 🐶 Dog profile based on individual characteristics
- 🕒 Suggested walking windows
- ⚠️ Weather-related guidance for heat, cold, wind, rain and snow
- 📝 Daily dog log for walks, bathroom breaks and grooming
- 🔥 Logging streaks and encouraging feedback
- 💡 Weather-aware daily tips
- 📚 Dog knowledge and practical guidance
- 🇸🇪 Swedish and 🇬🇧 English interface
- 📱 Responsive navigation and mobile bottom tab bar
- ♿ Accessible, readable and touch-friendly interface

## Dog Comfort Index

The Dog Comfort Index presents an educational estimate of current walking conditions on a scale from 0 to 10. The calculation can consider factors such as:

- perceived temperature
- humidity
- precipitation
- snowfall
- wind and gusts
- the saved dog profile

The index is intended as general guidance only. It is not a clinical assessment and does not replace veterinary advice or the dog owner's own judgement.

## Dog profile

A saved dog profile can be used to make the experience more relevant to the individual dog. Recommendations should remain cautious and clearly explain that breed, size, age, coat, health, fitness and individual tolerance can affect suitable activity.

## Dog log

The log is designed to be quick, friendly and habit-forming. Emojis are intentionally retained because they make common actions easy to recognize and give the experience warmth.

Example entries:

- 🚶 Walk
- 💩 Poop
- 💦 Pee
- 💧 Water break
- 🛁 Bath
- ✂️ Coat trim
- 💅 Nail trim
- 😴 Rest

## Data sources

The application is designed to use open forecast data, with SMHI as the primary source for Swedish locations and Open-Meteo as a global source or fallback. Place search may use OpenStreetMap Nominatim.

Always review the terms, attribution requirements and usage policies of each external data provider before production deployment.

## Project structure

```text
/
├── index.html        Main application and page structure
├── app.js            Weather, comfort index, logging and UI logic
├── styles.css        Responsive layout and visual design
├── assets/           Logo, hero images, icons and article imagery
└── README.md         Project documentation
```

Adjust the structure above if the actual repository uses different filenames or folders.

## Run locally

Because browser security rules can block API requests or modules when opening files directly, run the project through a local web server.

Example with Python:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Design principles

- Show immediate value before asking the user to search
- Keep the Dog Comfort Index visually prominent
- Provide short, actionable recommendations
- Preserve emojis in the log, streaks and positive feedback
- Keep navigation consistent across forecast, log and knowledge pages
- Prioritize mobile usability and accessibility
- Use calm colors, clear hierarchy and generous spacing
- Avoid presenting general guidance as veterinary advice

## SEO and content architecture

Recommended knowledge categories:

- Health
- Safety
- Walking
- Weather
- Training
- Puppies
- Senior dogs

Weather states can link to relevant articles, such as safe walks in heat, winter paw care, rain protection and support during thunderstorms. Every article should use reliable sources and include clear internal links back to relevant tools or forecasts.

## Privacy

Dog profiles and log entries should be stored with the minimum data necessary. If local storage is used, explain that the information remains in the current browser. If accounts or cloud synchronization are added later, publish an updated privacy notice and review applicable data-protection requirements.

## Limitations

- Weather forecasts can change
- Local ground and pavement conditions may differ from model data
- The Dog Comfort Index is educational guidance, not a scientifically validated or veterinary diagnostic tool
- Individual dogs can react differently to the same conditions
- Severe symptoms or rapid deterioration require prompt veterinary assessment

## Brand

**Doginary** combines dog-focused guidance, everyday logging and accessible knowledge.

Suggested tagline:

> Know what your dog needs before every walk.

## Status

Doginary is under active development. Current priorities include refining the dashboard experience, expanding the knowledge architecture, improving weather-aware recommendations and testing the experience across mobile devices.

## License

Add the chosen license before public distribution. If no license is included, others do not automatically receive permission to copy, modify or redistribute the project.
