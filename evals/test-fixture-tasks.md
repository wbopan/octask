# TASKS

A sample project for testing the starting-task skill.

## Core Features

Description: Basic CRUD operations working end-to-end with persistent storage.

- [x] Set up Express server with SQLite #setup-express-sqlite
    Database connection, basic middleware, health endpoint.
    AC: Server starts, connects to SQLite, and responds to /api/health.
    CM: Used better-sqlite3 for sync API. Added CORS and JSON body parser.
- [ ] User authentication with JWT #user-auth-jwt
    Email/password registration and login, JWT token issuance and validation middleware.
    AC: Users can register, login, and access protected routes with valid JWT.
- [/] CRUD API for projects #crud-api-projects
    RESTful endpoints for creating, reading, updating, and deleting projects. Each project belongs to a user.
    AC: All CRUD operations work; users can only access their own projects.
- [ ] Error handling middleware #error-handling-middleware
    Centralized error handling with proper HTTP status codes and error response format.
    AC: All API errors return consistent JSON format with appropriate status codes.

## Frontend

Description: A usable React frontend that connects to the API and lets users manage their projects.

- [ ] React app scaffolding with Vite #react-scaffold
    Set up React + TypeScript + Vite, configure proxy to backend, add Tailwind CSS.
    AC: Dev server starts with hot reload and proxies API requests to Express backend.
- [ ] Login and registration pages #login-register-pages
    Forms for email/password auth, token storage, redirect on success.
    AC: Users can register and login from the browser; JWT stored in localStorage.
- [-] Dashboard with project list #dashboard-project-list
    Main page showing user's projects with create/edit/delete actions.
    AC: Dashboard loads projects from API and supports all CRUD operations inline.
