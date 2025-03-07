#!/bin/bash
# This deployment script installs dependencies, builds the project, and starts the server.
npm install
npm run build
npm start 