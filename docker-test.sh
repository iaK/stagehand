#!/bin/bash
# Quick script to build, run, and clean up the test container

IMAGE_NAME="stagehand-test"
CONTAINER_NAME="stagehand-sandbox"

case "${1:-run}" in
  build)
    echo "Building image (this takes a while the first time, then layers are cached)..."
    docker build -t "$IMAGE_NAME" .
    ;;
  run)
    # Build if image doesn't exist
    if ! docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
      echo "Image not found, building first..."
      docker build -t "$IMAGE_NAME" .
    fi
    # Remove any existing container with same name
    docker rm -f "$CONTAINER_NAME" 2>/dev/null
    echo "Starting container..."
    docker run -it --rm \
      --name "$CONTAINER_NAME" \
      -p 6080:6080 \
      "$IMAGE_NAME"
    ;;
  destroy)
    echo "Stopping container and removing image..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null
    docker rmi "$IMAGE_NAME" 2>/dev/null
    echo "Done. Run './docker-test.sh run' to start fresh."
    ;;
  shell)
    if docker inspect "$CONTAINER_NAME" > /dev/null 2>&1; then
      docker exec -it "$CONTAINER_NAME" bash
    else
      echo "No running container. Run './docker-test.sh run' first."
    fi
    ;;
  rebuild)
    echo "Destroying and rebuilding from scratch..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null
    docker rmi "$IMAGE_NAME" 2>/dev/null
    docker build --no-cache -t "$IMAGE_NAME" .
    ;;
  *)
    echo "Usage: ./docker-test.sh [build|run|destroy|rebuild|shell]"
    echo ""
    echo "  build    - Build the Docker image"
    echo "  run      - Build (if needed) and run the container (default)"
    echo "  shell    - Open another shell into the running container"
    echo "  destroy  - Remove container and image"
    echo "  rebuild  - Full clean rebuild (no cache)"
    ;;
esac
