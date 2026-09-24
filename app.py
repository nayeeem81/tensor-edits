from route import app

if __name__ == "__main__":
    # Starts the Flask application in development mode
    app.run(host="127.0.0.1", port=5000, debug=True)
