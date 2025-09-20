# Use AWS Lambda Node.js 20 runtime
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies for Sharp (native image processing)
RUN dnf update -y && \
    dnf install -y \
    libvips-devel \
    && dnf clean all

# Copy package files
COPY package*.json ${LAMBDA_TASK_ROOT}/

# Install Node.js dependencies
RUN npm ci --only=production --no-audit --no-fund

# Copy Lambda function code
COPY upload-lambda.js ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD [ "upload-lambda.handler" ]