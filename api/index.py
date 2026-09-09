"""Vercel entrypoint for the simulation-only FastAPI application."""

from backend.app.simulation_app import app

__all__ = ["app"]
