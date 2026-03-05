-- 创建数据库
CREATE DATABASE IF NOT EXISTS EVE_Fetch_Data;
USE EVE_Fetch_Data;

-- 创建星域表
CREATE TABLE regions (
    region_id INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
);

-- 创建星座表
CREATE TABLE constellations (
    constellation_id INT PRIMARY KEY,
    region_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    x DOUBLE,
    y DOUBLE,
    z DOUBLE,
    FOREIGN KEY (region_id) REFERENCES regions(region_id) ON DELETE CASCADE,
    INDEX idx_region (region_id) -- 添加索引
);

-- 创建星系表
CREATE TABLE star_systems (
    system_id INT PRIMARY KEY,
    constellation_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    security_class CHAR(1),
    security_status FLOAT,
    star_id INT,
    x DOUBLE,
    y DOUBLE,
    z DOUBLE,
    FOREIGN KEY (constellation_id) REFERENCES constellations(constellation_id) ON DELETE CASCADE,
    INDEX idx_constellation (constellation_id) -- 添加索引
);

-- 创建星门表
CREATE TABLE stargates (
    stargate_id INT PRIMARY KEY,
    system_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    type_id INT,
    destination_system_id INT,
    destination_stargate_id INT,
    x DOUBLE,
    y DOUBLE,
    z DOUBLE,
    FOREIGN KEY (system_id) REFERENCES star_systems(system_id) ON DELETE CASCADE,
    INDEX idx_system (system_id), -- 添加索引
    INDEX idx_destination_system (destination_system_id) -- 添加索引
);

CREATE TABLE crawl_progress (
    category VARCHAR(50) NOT NULL,
    last_id INT NOT NULL,
    PRIMARY KEY (category)
);