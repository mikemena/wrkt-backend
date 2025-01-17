const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();
const path = require('path');

// Load .env only in development
if (process.env.NODE_ENV !== 'production') {
  app.set('trust proxy', 1);
  require('dotenv').config();
}

// Middleware to parse JSON bodies
app.use(express.json());

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:', '*.r2.cloudflarestorage.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", '*.r2.cloudflarestorage.com']
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  })
);

// Serve static files from the images directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// CORS - allow your local frontend in development
const corsOptions = {
  origin:
    process.env.NODE_ENV === 'production'
      ? [
          'https://wrkt.fitness',
          'https://www.wrkt.fitness',
          'https://api.wrkt.fitness',
          'exp://localhost:19000',
          'your-app-scheme://',
          /\.expo\.dev$/,
          /\.wrkt\.fitness$/
        ]
      : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control'],
  exposedHeaders: ['ETag'],
  credentials: true
};

// Apply CORS with environment-specific options
app.use(cors(corsOptions));

// Rate limiting - stricter in production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000
});

app.use(limiter);

// Add security headers in production
if (process.env.NODE_ENV === 'production') {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"]
        }
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false
    })
  );
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message
  });
});

// Logging based on environment
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Import routes
const imageRoutes = require('./routes/images');
const musclesRoutes = require('./routes/muscles');
const equipmentsRoutes = require('./routes/equipment_catalog');
const exerciseCatalogRoutes = require('./routes/exercise_catalog');
const usersRoutes = require('./routes/users');
const programRoutes = require('./routes/programs');
const workoutRoutes = require('./routes/workout');
const userSetsRoutes = require('./routes/sets');
const settingsRoutes = require('./routes/settings');
const userExercisesRoutes = require('./routes/exercises');
const workoutHistoryRoutes = require('./routes/workout_history');
const activeProgramRoutes = require('./routes/active_program');
const progressRoutes = require('./routes/progress');
const healthRoutes = require('./routes/health');

// Use your routes with a base path
app.use('/api', imageRoutes);
app.use('/api', musclesRoutes);
app.use('/api', equipmentsRoutes);
app.use('/api', exerciseCatalogRoutes);
app.use('/api', usersRoutes);
app.use('/api', settingsRoutes);
app.use('/api', workoutRoutes);
app.use('/api', userSetsRoutes);
app.use('/api', userExercisesRoutes);
app.use('/api', workoutHistoryRoutes);
app.use('/api', programRoutes);
app.use('/api', activeProgramRoutes);
app.use('/api', progressRoutes);
app.use('/api', healthRoutes);

const PORT = process.env.PORT || 9025;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('Production URLs:');
    console.log('- API URL: https://api.wrkt.fitness');
  }
});
