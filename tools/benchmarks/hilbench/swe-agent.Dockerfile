# SPDX-License-Identifier: AGPL-3.0-or-later
#
# THEIR SWE-agent (the fork in their repository, 1.1.0 with SWE-ReX 1.4.0), installed as is. Nothing
# of ours goes in: run-swe-task.sh passes the config, the model and the instances at run time.
#
#   docker build -t hil-swe-agent:1.1.0 -f swe-agent.Dockerfile "$HIL_BENCH/SWE-agent"
#
# Reconstructed 17/09/2026 from `docker history` of the image the first SWE runs used, whose
# Dockerfile was not kept. Python packages are not pinned beyond what their setup declares.
FROM python:3.12-slim
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
COPY . /opt/swe-agent
WORKDIR /opt/swe-agent
RUN rm -rf sweagent.egg-info trajectories && mkdir -p trajectories \
 && pip install --no-cache-dir --root-user-action=ignore -e . \
 && python -c "import sweagent; print('sweagent', sweagent.__version__)"
