import requests
import pymysql
import sys

# 数据库连接配置
db_config = {
    'host': 'localhost',
    'user': 'root',  # 替换为你的用户名
    'password': '123456',  # 替换为你的密码
    'db': 'eve_fetch_data',  # 数据库名
    'autocommit': True  # 确保所有更改都会立即提交到数据库
}

# EVE API的URL
EVE_API_URL = 'https://esi.evetech.net/latest/'


# 更新进度
def update_progress(cursor, category, last_id):
    cursor.execute(
        "INSERT INTO crawl_progress (category, last_id) VALUES (%s, %s) ON DUPLICATE KEY UPDATE last_id = VALUES(last_id)",
        (category, last_id)
    )


# 获取进度
def get_progress(cursor, category):
    cursor.execute(
        "SELECT last_id FROM crawl_progress WHERE category = %s",
        (category,)
    )
    result = cursor.fetchone()
    return result['last_id'] if result else None


# 从API获取数据
def fetch_from_api(endpoint):
    response = requests.get(EVE_API_URL + endpoint)
    if response.status_code == 200:
        return response.json()
    else:
        response.raise_for_status()


# 数据存储逻辑
def store_data(cursor, table_name, columns, data):
    placeholders = ', '.join(['%s'] * len(columns))
    sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders}) ON DUPLICATE KEY UPDATE"
    update_statement = ', '.join([f"{col}=VALUES({col})" for col in columns])
    sql = f"{sql} {update_statement}"
    try:
        cursor.execute(sql, data)
        print(f"Data prepared for storage in {table_name} for {data[1]}")
    except Exception as e:
        print(f"Error inserting into {table_name} for {data[1]}: {e}")


# 爬取数据的函数
def crawl_data():
    with pymysql.connect(**db_config) as connection:
        with connection.cursor(pymysql.cursors.DictCursor) as cursor:
            # 爬取星域数据
            print("Crawling regions...")
            last_region_id = get_progress(cursor, 'region') or 0
            regions = fetch_from_api('universe/regions/')
            for region_id in regions:
                if region_id > last_region_id:
                    region_data = fetch_from_api(f'universe/regions/{region_id}/')
                    store_data(cursor, 'regions', ['region_id', 'name', 'description'], [
                        region_id,
                        region_data['name'],
                        region_data.get('description', '')
                    ])
                    update_progress(cursor, 'region', region_id)
                    print(f"Stored region: {region_data['name']}")

            # 爬取星座数据
            print("Crawling constellations...")
            last_constellation_id = get_progress(cursor, 'constellation') or 0
            for region_id in regions:
                region_data = fetch_from_api(f'universe/regions/{region_id}/')
                for constellation_id in region_data['constellations']:
                    if constellation_id > last_constellation_id:
                        constellation_data = fetch_from_api(f'universe/constellations/{constellation_id}/')
                        store_data(cursor, 'constellations', ['constellation_id', 'region_id', 'name', 'x', 'y', 'z'], [
                            constellation_id,
                            region_id,
                            constellation_data['name'],
                            constellation_data['position']['x'],
                            constellation_data['position']['y'],
                            constellation_data['position']['z']
                        ])
                        update_progress(cursor, 'constellation', constellation_id)
                        print(f"Stored constellation: {constellation_data['name']}")

            # 爬取星系数据
            print("Crawling star systems...")
            last_system_id = get_progress(cursor, 'star_system') or 0
            cursor.execute("SELECT constellation_id FROM constellations")
            constellations = cursor.fetchall()
            for constellation in constellations:
                constellation_id = constellation['constellation_id']
                constellation_data = fetch_from_api(f'universe/constellations/{constellation_id}/')
                for system_id in constellation_data['systems']:
                    if system_id > last_system_id:
                        system_data = fetch_from_api(f'universe/systems/{system_id}/')
                        store_data(cursor, 'star_systems',
                                   ['system_id', 'constellation_id', 'name', 'security_class', 'security_status',
                                    'star_id',
                                    'x', 'y', 'z'], [
                                       system_id,
                                       constellation_id,
                                       system_data['name'],
                                       system_data.get('security_class', ''),
                                       system_data['security_status'],
                                       system_data.get('star_id', 0),
                                       system_data['position']['x'],
                                       system_data['position']['y'],
                                       system_data['position']['z']
                                   ])
                        update_progress(cursor, 'star_system', system_id)
                        print(f"Stored star system: {system_data['name']}")

                        # 存储星门数据
                        for stargate_id in system_data.get('stargates', []):
                            stargate_data = fetch_from_api(f'universe/stargates/{stargate_id}/')
                            store_data(cursor, 'stargates',
                                       ['stargate_id', 'system_id', 'name', 'type_id', 'destination_system_id',
                                        'destination_stargate_id', 'x', 'y', 'z'],
                                       [
                                           stargate_id,
                                           system_id,
                                           stargate_data['name'],
                                           stargate_data['type_id'],
                                           stargate_data['destination']['system_id'],
                                           stargate_data['destination']['stargate_id'],
                                           stargate_data['position']['x'],
                                           stargate_data['position']['y'],
                                           stargate_data['position']['z']
                                       ])
                            update_progress(cursor, 'stargate', stargate_id)
                            print(f"Stored stargate: {stargate_data['name']}")


# 主函数
def main():
    try:
        crawl_data()
    except requests.HTTPError as http_err:
        print(f"HTTP error occurred: {http_err}")
    except pymysql.MySQLError as db_err:
        print(f"Database error occurred: {db_err}")
    except Exception as err:
        print(f"An error occurred: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
