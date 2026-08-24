#pragma once

#include "node_config.h"

fogsen::XiaoSensorNode fogsen_rear_node(fogsen_rear::kNodeConfig);

void setup() {
  fogsen_rear_node.begin();
}

void loop() {
  fogsen_rear_node.update();
}
