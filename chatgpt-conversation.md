Browser Monitoring Extension – Project Spec Summary
Project Goal

Build a Chrome extension + backend system that monitors changes in webpage content (price changes, stock changes, content updates, etc.) and alerts users when differences are detected.

The system should support:

Frequent scheduled checks (ex: every minute)
Many users/tasks
Persistent browser automation
Scalable background processing
Failover and backup infrastructure
High-Level Architecture
1. Chrome Extension

Responsibilities:

Allow user to select an element on a webpage
Save:
URL
CSS selector / XPath
Screenshot region
Monitoring interval
Send monitoring configuration to backend

Possible Tech:

JavaScript / TypeScript
Chrome Extension Manifest V3
React (optional for UI)
2. Backend Monitoring Service
Core Idea

Instead of running monitoring inside the browser extension, offload all heavy work to backend workers.

Responsibilities:

Schedule monitoring jobs
Launch browser automation
Detect changes
Store results
Send alerts
3. Browser Automation Layer
Recommended Tools
Preferred
Playwright
Alternative
Puppeteer

Why:

Supports Chromium
Headless or full browser mode
Reliable automation
Screenshot support
DOM inspection support
4. Scheduling Architecture
Problem

Many users may request:

Check every minute
Multiple pages
Long-running schedules

Running independent timers per user is inefficient.

Recommended Solution: Central Job Queue
Architecture

Users create monitoring jobs → jobs enter queue → worker processes consume queue.

Instead of:

1000 separate timers

Use:

One centralized scheduler
Shared worker pool
Example Scheduling Flow
Example

User wants:

Stock price check
Every 1 minute
For 1 hour

System creates:

60 scheduled tasks

Workers process:

1 task per minute
Recommended Backend Stack
Option A (Recommended)
Node.js Stack
Node.js
Playwright
BullMQ
Redis
PostgreSQL
Purpose
Component	Purpose
Node.js	Backend runtime
Playwright	Browser automation
BullMQ	Queue & scheduling
Redis	Queue storage
PostgreSQL	Persistent data
Scheduling Technology
Recommended
BullMQ

Why:

Handles delayed jobs
Recurring jobs
Retries
Scales well
Multiple workers supported
Simpler Alternative
Cron Jobs

Use OS cron scheduler for:

Small projects
Personal use
Low scale

Not ideal for:

Large user base
Dynamic schedules
Worker Architecture
Recommended Design
Scheduler Process

Responsible for:

Determining when tasks run
Pushing tasks into queue
Worker Processes

Responsible for:

Opening browser
Checking content
Comparing changes
Saving results
Scaling Strategy
Add More Workers

As load increases:

Add more worker processes
Or more servers

Workers pull jobs from shared Redis queue.

Persistent Browser Requirement
Requirement

Project needs:

Browser running continuously
Long-lived sessions
Possible logged-in states
Infrastructure Recommendation
Home Server (Primary)

Use:

Dedicated mini PC
Linux machine
Docker containers

Recommended:

Ubuntu Server
Docker
PM2 or systemd
Failover / Backup Strategy
Problem

Home internet or power may fail.

Recommended Backup

Cloud fallback server.

Recommended Cloud Service
Amazon Web Services

Options:

Service	Purpose
EC2	Virtual machine
WorkSpaces	Persistent cloud desktop
Best Option for Persistent Browser
Recommended
Amazon WorkSpaces

Why:

Persistent desktop session
Browser stays open
Suitable for long-running automation
Easier for GUI browser automation
AWS WorkSpaces Pricing (Discussed)

Two billing modes:

Monthly flat rate
Hourly usage

Approximate pricing:

~$31/month for standard setup
Or hourly billing

Best for:

Backup environment
Failover browser node
Auto Startup Requirements
On Server Startup

System should automatically:

Launch browser
Start Node.js backend
Resume monitoring jobs
Recommended Startup Setup
Linux Services

Use:

systemd
OR
PM2

Responsibilities:

Auto restart Node app
Auto launch browser
Recover after reboot
Suggested MVP Architecture
Chrome Extension
        ↓
REST API Backend
        ↓
Redis Queue (BullMQ)
        ↓
Worker Processes
        ↓
Playwright Browser Automation
        ↓
PostgreSQL Database
        ↓
Notification Service
Suggested MVP Features
Phase 1
Manual page monitoring
Scheduled checks
Screenshot comparison
Email notifications
Phase 2
AI-based visual difference detection
Multi-user support
Cloud failover
Dashboard
Real-time alerts
Phase 3
Distributed workers
Smart throttling
Proxy rotation
Anti-bot handling
Horizontal scaling
Final Recommended Stack
Area	Recommendation
Frontend	Chrome Extension + React
Backend	Node.js
Browser Automation	Playwright
Queue	BullMQ
Queue Storage	Redis
Database	PostgreSQL
Hosting	Home Server
Backup	AWS EC2 / WorkSpaces
Process Manager	PM2 or systemd
Containers	Docker